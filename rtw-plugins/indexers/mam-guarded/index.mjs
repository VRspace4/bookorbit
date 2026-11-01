// mam-guarded plugin entry: see wrap.mjs. Needs the MyAnonaMouse plugin installed in the sibling directory.
import myanonamouse from "../myanonamouse/index.mjs";

import { wrap } from "./wrap.mjs";

export default wrap(myanonamouse);
