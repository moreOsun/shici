/* 后续扩充书库插槽：把新抓取的诗词按同结构 push 进来即可。
 * 元素结构：{ id:'E00001', t:'标题', a:'作者', p:'词牌(可选)', c:['句子…'], kind:'tang|song', dyn:'唐|宋|…' }
 * 生成工具参考 tools/fetch_data.py（支持御定全唐诗/宋词，可扩展元曲、诗经等目录）
 */
window.SHICI_EXTRA = window.SHICI_EXTRA || [];
