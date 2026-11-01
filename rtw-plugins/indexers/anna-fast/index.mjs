// anna-fast plugin entry: see wrap.mjs. Needs ShadowLib installed in the sibling plugin directory.
import shadowlib from "../bookorbit-shadowlib-plugin/index.mjs";

import { wrap } from "./wrap.mjs";

export default wrap(shadowlib);
