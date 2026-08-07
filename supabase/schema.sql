-- =========================================================
-- SCHEMA: Telegram Mini App - Herramientas + Referidos
-- Ejecutar completo en el SQL Editor de Supabase
-- =========================================================

-- Extensión necesaria para gen_random_uuid()
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- TABLA: users
-- ---------------------------------------------------------
create table if not exists public.users (
  telegram_id     bigint primary key,
  username        text,
  points          numeric(12,4) not null default 0,
  total_referrals integer not null default 0,
  referred_by     bigint references public.users(telegram_id),
  created_at      timestamptz not null default now()
);

create index if not exists idx_users_referred_by on public.users(referred_by);

-- ---------------------------------------------------------
-- TABLA: transactions (solicitudes de retiro)
-- ---------------------------------------------------------
create table if not exists public.transactions (
  id             uuid primary key default gen_random_uuid(),
  telegram_id    bigint not null references public.users(telegram_id),
  amount         numeric(12,4) not null,
  status         text not null default 'pending' check (status in ('pending','paid','rejected')),
  payout_details text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_transactions_telegram_id on public.transactions(telegram_id);

-- ---------------------------------------------------------
-- TABLA: ad_events (control anti-abuso de recompensas)
-- Guarda cada anuncio "completado" verificado para evitar
-- que el mismo usuario reclame puntos infinitas veces por
-- request-spoofing o doble click.
-- ---------------------------------------------------------
create table if not exists public.ad_events (
  id          uuid primary key default gen_random_uuid(),
  telegram_id bigint not null references public.users(telegram_id),
  points      numeric(12,4) not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_ad_events_telegram_created
  on public.ad_events(telegram_id, created_at desc);

-- ---------------------------------------------------------
-- CONFIGURACIÓN (ajusta estos valores a tu economía)
-- ---------------------------------------------------------
--  REWARD_PER_AD           -> puntos que gana el usuario por ver 1 anuncio
--  REFERRAL_COMMISSION_PCT -> % que gana el referente sobre lo que gana su referido
--  MIN_SECONDS_BETWEEN_ADS -> cooldown anti-spam por usuario
-- Estos valores viven como constantes dentro de las funciones RPC
-- de abajo; edítalos ahí si cambian.

-- ---------------------------------------------------------
-- FUNCIÓN: registrar usuario + relación de referido (atómica)
-- ---------------------------------------------------------
create or replace function public.register_user(
  p_telegram_id bigint,
  p_username    text,
  p_ref_id      bigint default null
)
returns void
language plpgsql
security definer
as $$
begin
  -- Si el usuario ya existe, solo actualizamos el username
  if exists (select 1 from public.users where telegram_id = p_telegram_id) then
    update public.users set username = coalesce(p_username, username)
      where telegram_id = p_telegram_id;
    return;
  end if;

  -- Evitar auto-referido y referidos a ids inexistentes
  if p_ref_id is not null and p_ref_id <> p_telegram_id
     and exists (select 1 from public.users where telegram_id = p_ref_id) then

    insert into public.users (telegram_id, username, referred_by)
    values (p_telegram_id, p_username, p_ref_id);

    update public.users
      set total_referrals = total_referrals + 1
      where telegram_id = p_ref_id;
  else
    insert into public.users (telegram_id, username)
    values (p_telegram_id, p_username);
  end if;
end;
$$;

-- ---------------------------------------------------------
-- FUNCIÓN: acreditar recompensa por anuncio visto (atómica)
-- Suma puntos al usuario y comisión al referente, y deja
-- registro en ad_events para auditoría / anti-abuso.
-- ---------------------------------------------------------
create or replace function public.credit_ad_reward(
  p_telegram_id bigint
)
returns numeric
language plpgsql
security definer
as $$
declare
  v_reward_per_ad numeric := 0.02;   -- puntos/USD por anuncio (ajustable)
  v_commission_pct numeric := 0.10;  -- 10% para el referente
  v_referrer bigint;
  v_last_event timestamptz;
  v_cooldown_seconds int := 20;      -- anti-spam entre anuncios
begin
  -- anti-abuso: cooldown mínimo entre recompensas del mismo usuario
  select created_at into v_last_event
    from public.ad_events
    where telegram_id = p_telegram_id
    order by created_at desc
    limit 1;

  if v_last_event is not null and
     now() - v_last_event < make_interval(secs => v_cooldown_seconds) then
    raise exception 'COOLDOWN_ACTIVE';
  end if;

  -- sumar puntos al usuario
  update public.users
    set points = points + v_reward_per_ad
    where telegram_id = p_telegram_id;

  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  -- registrar evento de auditoría
  insert into public.ad_events (telegram_id, points)
    values (p_telegram_id, v_reward_per_ad);

  -- comisión para el referente, si existe
  select referred_by into v_referrer
    from public.users where telegram_id = p_telegram_id;

  if v_referrer is not null then
    update public.users
      set points = points + (v_reward_per_ad * v_commission_pct)
      where telegram_id = v_referrer;
  end if;

  return v_reward_per_ad;
end;
$$;

-- ---------------------------------------------------------
-- FUNCIÓN: solicitar retiro (atómica: valida saldo y descuenta)
-- ---------------------------------------------------------
create or replace function public.request_withdrawal(
  p_telegram_id    bigint,
  p_amount         numeric,
  p_payout_details text,
  p_min_amount     numeric default 5.00
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_points numeric;
  v_tx_id  uuid;
begin
  select points into v_points from public.users
    where telegram_id = p_telegram_id
    for update; -- lock de fila para evitar condiciones de carrera

  if v_points is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  if p_amount < p_min_amount then
    raise exception 'BELOW_MINIMUM';
  end if;

  if p_amount > v_points then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;

  update public.users
    set points = points - p_amount
    where telegram_id = p_telegram_id;

  insert into public.transactions (telegram_id, amount, status, payout_details)
    values (p_telegram_id, p_amount, 'pending', p_payout_details)
    returning id into v_tx_id;

  return v_tx_id;
end;
$$;

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
-- El backend usa la Service Role Key (bypassa RLS), así que
-- estas políticas solo protegen si algún día expones la anon key
-- directamente al cliente para lecturas.
-- ---------------------------------------------------------
alter table public.users enable row level security;
alter table public.transactions enable row level security;
alter table public.ad_events enable row level security;

-- Bloquea todo acceso directo por default (el backend usa service_role,
-- que ignora RLS). No se crean políticas permisivas a propósito.
