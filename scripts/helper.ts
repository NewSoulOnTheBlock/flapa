// Runs the trade helper with .env loaded (Bun loads it; node alone would not), for checks from the shell.
//   bun scripts/helper.ts <command> '<json args>'
// Use dryRun:true on buy/sell to simulate without signing or sending anything.
const [cmd = 'address', json = '{}'] = process.argv.slice(2)
const p = Bun.spawn(['node', new URL('../helper/trade.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), cmd, json], { stdout: 'pipe', stderr: 'pipe', env: process.env })
const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
const line = out.trim().split('\n').pop() ?? ''
console.log(line || err.slice(0, 300))
