// Describes the shape of each X key in .env (length, character classes, the user-id prefix X access tokens
// carry), so a mix-up can be spotted without ever printing a value.
const shape = (v = '') => ({
  length: v.length,
  digitsDashPrefix: /^\d{5,}-/.test(v), // X access tokens look like "<numeric user id>-<random>"
  hasDash: v.includes('-'),
  onlyAlnum: /^[A-Za-z0-9]+$/.test(v),
  looksBearer: v.startsWith('AAAA'), // app bearer tokens start like this
  hasSpaceOrQuote: /[\s"']/.test(v),
})
for (const k of ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET']) console.log(k, JSON.stringify(shape(process.env[k])))
