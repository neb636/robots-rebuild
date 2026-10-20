// The knock code, from the thin wall between Theo's walkup and Marcus's when they were nine: two
// knocks means "you there?", one back means "yes". Theo knocks with the interact button, one knock a
// press; a pause ends the phrase, and whoever's listening hears how many it was. It comes back at the
// Long Wharf railing and at a maintenance door in the Valley.
import { audio } from './audio';

/** seconds of quiet after the last knock that end a phrase */
const PHRASE_GAP = 1.1;

export class KnockCode {
  private n = 0;
  private quiet = 0;
  /** a phrase ended: `count` knocks */
  onPhrase: ((count: number) => void) | null = null;

  /** one knock on whatever Theo's at (the sound plays now) */
  knock() {
    audio.knock(0, 0);
    this.n++;
    this.quiet = 0;
  }

  /** knocks in the phrase so far */
  get count() { return this.n; }

  /** call every frame (game time): ends the phrase once the knocking stops */
  update(dt: number) {
    if (!this.n) return;
    if ((this.quiet += dt) < PHRASE_GAP) return;
    const n = this.n;
    this.n = 0;
    this.onPhrase?.(n);
  }
}
