import { VipStealConfig } from './vipSteal';

interface SimulatedHolder {
  userLogin: string;
  addedAt: number;
}

class VipStealSimulator {
  private holders: SimulatedHolder[] = [];

  getHolders(): SimulatedHolder[] {
    return [...this.holders];
  }

  reset(): void {
    this.holders = [];
  }

  simulate(userLogin: string, config: VipStealConfig): string {
    if (this.holders.some((h) => h.userLogin.toLowerCase() === userLogin.toLowerCase())) {
      return `@${userLogin} already holds a fake VIP slot!`;
    }

    if (this.holders.length < config.maxVips) {
      this.holders.push({ userLogin, addedAt: Date.now() });
      return `@${userLogin} granted fake VIP! (${this.holders.length}/${config.maxVips} slots used)`;
    }

    const victim =
      config.stealStrategy === 'fifo'
        ? this.holders.reduce((a, b) => (a.addedAt < b.addedAt ? a : b))
        : this.holders[Math.floor(Math.random() * this.holders.length)];

    this.holders = this.holders.filter((h) => h !== victim);
    this.holders.push({ userLogin, addedAt: Date.now() });

    const note = config.stealStrategy === 'fifo' ? '(oldest holder)' : '(randomly selected)';
    const current = this.holders.map((h) => h.userLogin).join(', ');
    return `@${userLogin} stole fake VIP from @${victim.userLogin} ${note}! Holders: ${current}`;
  }
}

export const fakeVipSimulator = new VipStealSimulator();
