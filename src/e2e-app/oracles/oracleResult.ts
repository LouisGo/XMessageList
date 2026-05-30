export type E2EOracleResult = {
  oracleId: string
  ok: boolean
  message: string
}

export type E2EOracle = () => E2EOracleResult
