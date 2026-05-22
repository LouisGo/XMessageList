export class RuntimeServiceRef<TService> {
  private value: TService | null = null

  constructor(private readonly name: string) {}

  setOnce(value: TService): void {
    if (this.value) {
      throw new Error(`runtime-service-ref-duplicate:${this.name}`)
    }

    this.value = value
  }

  get(): TService {
    if (!this.value) {
      throw new Error(`runtime-service-ref-unbound:${this.name}`)
    }

    return this.value
  }
}
