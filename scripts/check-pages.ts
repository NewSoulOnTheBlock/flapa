// Parses the inline script of each dashboard page, so a syntax slip is caught before a browser sees it.
for (const path of ['web/index.html', 'site/index.html']) {
  const html = await Bun.file(new URL(`../${path}`, import.meta.url)).text()
  const js = html.split('<script>')[1]?.split('</script>')[0]
  if (!js) throw new Error(`${path}: no inline script`)
  new Function(js)
  console.log(`${path}: script parses`)
}
