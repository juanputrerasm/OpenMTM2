/*
  The screen stack.

  A screen is a module whose default export is `mount(container, context, params)`. It builds
  its DOM inside `container` and may return `{ unmount() }` to release what it holds (workers,
  render loops, listeners). Going to a screen replaces the current one; `back()` returns to the
  previous screen with the parameters it was opened with.
*/

export class Router {
  constructor(container, context, screens) {
    this.container = container;
    this.context = context;
    this.screens = screens;
    this.stack = [];
    this.current = null;
  }

  async go(name, params = {}, { replace = false } = {}) {
    const load = this.screens[name];
    if (!load) throw new Error(`Unknown screen "${name}"`);
    if (replace) this.stack.pop();
    this.stack.push({ name, params });
    await this._show(load, params);
  }

  async back() {
    if (this.stack.length < 2) return;
    this.stack.pop();
    const { name, params } = this.stack[this.stack.length - 1];
    await this._show(this.screens[name], params);
  }

  async _show(load, params) {
    this.current?.unmount?.();
    this.current = null;
    this.container.replaceChildren();
    const module = await load();
    this.current = (await module.default(this.container, this.context, params)) ?? null;
  }
}
