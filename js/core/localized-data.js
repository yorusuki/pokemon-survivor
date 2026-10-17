/* 依穩定 ID 本地化名稱，避免屬性／招式的同名文字混淆。存檔仍使用原本 ID。 */
(() => {
  if (G.I18n.lang !== 'zh-TW' || !G.ZH_NAMES) return;
  for (const p of G.DEX) p.name = G.ZH_NAMES.pokemon[p.dex] || p.name;
  for (const m of Object.values(G.Moves.BY_ID)) m.name = G.ZH_NAMES.moves[m.id] || m.name;
  for (const item of G.Items.LIST) item.name = G.ZH_NAMES.items[item.id] || item.name;
})();
