import type { IconRenderer } from '../assets/IconRenderer';
import { RECIPES, type RecipeId } from '../game/Items';
import type { Order, Stats } from '../game/Orders';

type Proc = 'knife' | 'pan' | 'pot' | null;
type TicketPart = { icon: string; proc: Proc; count?: number };

const TICKET_PARTS: Record<RecipeId, TicketPart[]> = {
  bigBurger: [
    { icon: 'raw:bun', proc: null },
    { icon: 'raw:patty', proc: 'pan' },
    { icon: 'raw:lettuce', proc: 'knife' },
    { icon: 'raw:tomato', proc: 'knife' },
  ],
  soup: [{ icon: 'raw:tomato', proc: 'pot', count: 3 }],
  noodles: [{ icon: 'raw:noodles', proc: 'pot', count: 2 }],
  salad: [
    { icon: 'raw:lettuce', proc: 'knife' },
    { icon: 'raw:tomato', proc: 'knife' },
  ],
  lonelyBurger: [
    { icon: 'raw:bun', proc: null },
    { icon: 'raw:patty', proc: 'pan' },
  ],
};

const PROC_SVG: Record<Exclude<Proc, null>, string> = {
  knife: '<svg class="proc" viewBox="0 0 24 24"><path d="M3 17 17 3c2 2 2 6-1 9l-6 6z"/><rect x="2" y="17" width="7" height="4" rx="1.5" transform="rotate(-45 5 19)"/></svg>',
  pan: '<svg class="proc" viewBox="0 0 24 24"><circle cx="9" cy="13" r="7"/><rect x="14" y="11" width="9" height="4" rx="2"/></svg>',
  pot: '<svg class="proc" viewBox="0 0 24 24"><path d="M4 9h16v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><rect x="2" y="7" width="20" height="3" rx="1.5"/></svg>',
};

type TicketEl = { root: HTMLElement; bar: HTMLElement; order: Order };

export type ScreenName = 'title' | 'countdown' | 'playing' | 'paused' | 'results';

export class Hud {
  private readonly hud = el('#hud');
  private readonly tickets = el('#tickets');
  private readonly botTickets = el('#bot-tickets');
  private readonly playerCoins = el('#player-coins');
  private readonly botCoins = el('#bot-coins');
  private readonly timer = el('#timer-value');
  private readonly clockFill = document.querySelector<SVGCircleElement>('#clock-fill')!;
  private readonly clockFace = document.querySelector<HTMLElement>('.clock-face')!;
  private readonly banner = el('#banner');
  private readonly floaters = el('#floaters');
  private readonly nameTags = el('#name-tags');
  private readonly screens = {
    title: el('#title-screen'),
    countdown: el('#countdown'),
    paused: el('#pause-screen'),
    results: el('#results-screen'),
  };
  private readonly ticketEls = new Map<number, TicketEl>();
  private readonly botTicketIds: number[] = [];
  private bannerTimer = 0;
  private lastCoins = [0, 0];
  private icons: IconRenderer | null = null;

  setIcons(icons: IconRenderer): void {
    this.icons = icons;
  }

  showScreen(name: ScreenName): void {
    this.screens.title.classList.toggle('hidden', name !== 'title');
    this.screens.countdown.classList.toggle('hidden', name !== 'countdown');
    this.screens.paused.classList.toggle('hidden', name !== 'paused');
    this.screens.results.classList.toggle('hidden', name !== 'results');
    this.hud.classList.toggle('hidden', name === 'title');
    this.nameTags.classList.toggle('hidden', name === 'title');
    document.querySelector('#touch-controls')?.classList.toggle('active', name === 'playing');
    if (name !== 'playing') this.hideBanner();
  }

  setLoadProgress(fraction: number): void {
    el('#load-fill').style.width = `${Math.round(fraction * 100)}%`;
  }

  setReady(playerImg: string, botImg: string): void {
    (el('#title-player-img') as HTMLImageElement).src = playerImg;
    (el('#title-bot-img') as HTMLImageElement).src = botImg;
    const play = el('#play-button') as HTMLButtonElement;
    play.disabled = false;
    play.textContent = 'Start cooking!';
    el('#load-bar').classList.add('hidden');
  }

  setLoadError(message: string): void {
    const play = el('#play-button') as HTMLButtonElement;
    play.textContent = message;
  }

  countdown(text: string): void {
    const value = el('#countdown-value');
    value.textContent = text;
    value.style.animation = 'none';
    void value.offsetWidth;
    value.style.animation = '';
  }

  reset(): void {
    this.tickets.replaceChildren();
    this.botTickets.replaceChildren();
    this.ticketEls.clear();
    this.botTicketIds.length = 0;
    this.lastCoins = [0, 0];
    this.setCoins(0, 0, false);
  }

  update(orders: Order[], botOrders: Order[], player: Stats, bot: Stats, timeLeft: number, total: number, delta: number): void {
    this.syncTickets(orders);
    this.syncBotTickets(botOrders);
    this.setCoins(player.coins, bot.coins, true);

    const secs = Math.max(0, Math.ceil(timeLeft));
    this.timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    this.clockFill.style.strokeDashoffset = String(169.6 * (1 - timeLeft / total));
    this.clockFace.classList.toggle('hurry', timeLeft <= 15 && timeLeft > 0);

    if (this.bannerTimer > 0) {
      this.bannerTimer -= delta;
      if (this.bannerTimer <= 0) this.hideBanner();
    }
  }

  showBanner(text: string, seconds = 1.6): void {
    this.banner.textContent = text;
    this.banner.classList.remove('hidden');
    this.banner.style.animation = 'none';
    void this.banner.offsetWidth;
    this.banner.style.animation = '';
    this.bannerTimer = seconds;
  }

  hideBanner(): void {
    this.banner.classList.add('hidden');
    this.bannerTimer = 0;
  }

  floatText(x: number, y: number, text: string, kind: 'coin' | 'bad' | 'info' = 'coin'): void {
    const f = document.createElement('div');
    f.className = `floater ${kind === 'coin' ? '' : kind}`;
    f.textContent = text;
    f.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    this.floaters.append(f);
    window.setTimeout(() => f.remove(), 1300);
  }

  markServed(orderId: number): void {
    const t = this.ticketEls.get(orderId);
    if (t) t.root.classList.add('served');
  }

  createNameTag(name: string, rival: boolean): HTMLElement {
    const tag = document.createElement('div');
    tag.className = `name-tag${rival ? ' rival' : ''}`;
    tag.textContent = name;
    this.nameTags.append(tag);
    return tag;
  }

  showResults(player: Stats, bot: Stats, playerImg: string, botImg: string): 'win' | 'lose' | 'draw' {
    const outcome = player.coins > bot.coins ? 'win' : player.coins < bot.coins ? 'lose' : 'draw';
    const title = el('#results-title');
    title.className = `bubble-title ${outcome === 'win' ? 'victory' : 'defeat'}`;
    title.innerHTML = `<span>${outcome === 'win' ? 'Victory' : outcome === 'lose' ? 'Defeat' : 'Draw'}</span>`;
    el('#results-sub').textContent =
      outcome === 'win' ? 'Chef’s kiss! Run it back?' : outcome === 'lose' ? 'Rematch? The kitchen is still hot.' : 'Too close to call. Tiebreaker?';
    el('#result-player').outerHTML = resultCard('result-player', 'You', player, playerImg, outcome === 'win');
    el('#result-bot').outerHTML = resultCard('result-bot', 'BrandynBot', bot, botImg, outcome === 'lose');
    return outcome;
  }

  setMuteLabel(muted: boolean): void {
    el('#mute-button').textContent = `Sound: ${muted ? 'Off' : 'On'}`;
  }

  private setCoins(player: number, bot: number, animate: boolean): void {
    this.playerCoins.querySelector('.coin-value')!.textContent = String(player);
    this.botCoins.querySelector('.coin-value')!.textContent = String(bot);
    if (animate) {
      if (player !== this.lastCoins[0]) bump(this.playerCoins, player > this.lastCoins[0] ? 'pop' : 'shake');
      if (bot !== this.lastCoins[1]) bump(this.botCoins, bot > this.lastCoins[1] ? 'pop' : 'shake');
    }
    this.lastCoins = [player, bot];
  }

  private syncTickets(orders: Order[]): void {
    const live = new Set(orders.map((o) => o.id));
    for (const [id, t] of this.ticketEls) {
      if (live.has(id) || t.root.classList.contains('leaving')) continue;
      t.root.classList.add('leaving');
      window.setTimeout(() => {
        t.root.remove();
        this.ticketEls.delete(id);
      }, 340);
    }
    for (const order of orders) {
      let t = this.ticketEls.get(order.id);
      if (!t) {
        t = this.createTicket(order);
        this.ticketEls.set(order.id, t);
        this.tickets.append(t.root);
      }
      const frac = Math.max(0, order.timeLeft / order.patience);
      t.bar.style.transform = `scaleX(${frac})`;
      t.bar.style.backgroundColor = frac > 0.5 ? 'var(--good)' : frac > 0.25 ? 'var(--warn)' : 'var(--bad)';
      t.root.classList.toggle('urgent', frac < 0.2);
    }
  }

  private syncBotTickets(orders: Order[]): void {
    const ids = orders.map((o) => o.id);
    if (ids.length === this.botTicketIds.length && ids.every((id, i) => id === this.botTicketIds[i])) return;
    this.botTicketIds.splice(0, this.botTicketIds.length, ...ids);
    this.botTickets.replaceChildren(
      ...orders.map((o) => {
        const d = document.createElement('div');
        d.className = 'mini-ticket';
        d.innerHTML = `<img alt="${o.recipe.name}" src="${this.icons?.url(`dish:${o.recipe.id}`) ?? ''}">`;
        return d;
      }),
    );
  }

  private createTicket(order: Order): TicketEl {
    const root = document.createElement('div');
    root.className = 'ticket';
    const parts = TICKET_PARTS[order.recipe.id]
      .map(
        (p) =>
          `<span class="ticket-part"><img alt="" src="${this.icons?.url(p.icon) ?? ''}">${p.proc ? PROC_SVG[p.proc] : ''}${
            p.count ? `<span class="count">×${p.count}</span>` : ''
          }</span>`,
      )
      .join('');
    root.innerHTML = `
      <div class="ticket-timer"><div></div></div>
      <img class="ticket-dish" alt="" src="${this.icons?.url(`dish:${order.recipe.id}`) ?? ''}">
      <span class="ticket-name">${RECIPES[order.recipe.id].name}</span>
      <div class="ticket-parts">${parts}</div>`;
    return { root, bar: root.querySelector('.ticket-timer div')!, order };
  }
}

function resultCard(id: string, who: string, s: Stats, img: string, winner: boolean): string {
  const crown = winner
    ? `<svg class="crown" viewBox="0 0 64 40"><path d="M4 36 8 8l14 14L32 2l10 20L56 8l4 28z" fill="#ffc93c" stroke="#2c2c46" stroke-width="4" stroke-linejoin="round"/></svg>`
    : '';
  return `<div class="result-card${winner ? ' winner' : ''}" id="${id}">
    ${crown}
    <img alt="" src="${img}">
    <strong class="who">${who}</strong>
    <div class="total"><span class="coin-icon"></span>${s.coins}</div>
    <dl>
      <dt>Dishes</dt><dd>${s.dishes}</dd>
      <dt>Tips</dt><dd>${s.tips}</dd>
      <dt>Expired</dt><dd>${s.expired}</dd>
      <dt>Best streak</dt><dd>${s.bestStreak}</dd>
    </dl>
  </div>`;
}

function bump(node: HTMLElement, cls: 'pop' | 'shake'): void {
  node.classList.remove('pop', 'shake');
  void node.offsetWidth;
  node.classList.add(cls);
}

function el(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`Missing element ${selector}`);
  return node;
}
