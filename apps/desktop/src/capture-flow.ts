import { randomUUID } from 'node:crypto'
import { manualOutcome, type SelectionOutcome } from './selection'

/** Latest intent wins; every trigger receives feedback, while native clipboard work stays serial. */
type CaptureEffects = {
  feedback(id: string, repeated: boolean): void
  read(id: string): Promise<SelectionOutcome>
  cancel(id: string): void
  complete(id: string, outcome: SelectionOutcome): void
  discarded(id: string, outcome: SelectionOutcome): void
}
export class CaptureFlow {
  private active?: string
  private readonly effects: CaptureEffects
  get reading(): boolean { return !!this.active }
  constructor(effects: CaptureEffects) { this.effects = effects }
  trigger(): void {
    const previous = this.active, id = randomUUID(); this.active = id
    this.effects.feedback(id, !!previous)
    if (previous) this.effects.cancel(previous)
    void Promise.resolve().then(() => this.effects.read(id)).catch(() => manualOutcome()).then(outcome => {
      if (this.active !== id) { this.effects.discarded(id, outcome); return }
      this.active = undefined; this.effects.complete(id, outcome)
    })
  }
  dismiss(): void { if (this.active) this.effects.cancel(this.active); this.active = undefined }
}
