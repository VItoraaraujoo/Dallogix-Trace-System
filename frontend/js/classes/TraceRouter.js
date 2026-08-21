export class TraceRouter {
  constructor(store, render) { this.store = store; this.render = render; }
  go(page) { this.store.navigate(page); this.render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
}
