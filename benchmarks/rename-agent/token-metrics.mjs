import { countTokens } from 'gpt-tokenizer/encoding/o200k_base'

export function protocolTokenMetrics({
  initializeRaw,
  instructions,
  tools,
  requestText,
  responseText,
}) {
  const initializeTokens = countTokens(initializeRaw)
  const instructionsTokensWithinInitialize = countTokens(instructions)
  const catalogTokens = countTokens(JSON.stringify(tools))
  const requestTokens = countTokens(requestText)
  const responseTokens = countTokens(responseText)
  return {
    initializeTokens,
    instructionsTokensWithinInitialize,
    catalogTokens,
    sessionFixedContextTokens: initializeTokens + catalogTokens,
    requestTokens,
    responseTokens,
    taskTokens: requestTokens + responseTokens,
  }
}
