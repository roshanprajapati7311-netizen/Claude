/* Minimal stand-in for the design tool's component base class, so the core runs on its own in the app. */
class DCLogic {
  constructor(props) {
    this.props = props || {};
    this.state = {};
    this._mounted = false;
  }
  setState(patch) {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = Object.assign({}, this.state, p);
    if (this._mounted && this._paint) this._paint();
  }
}
