// abb-torbox plugin entry: see wrap.mjs. Needs the AudiobookBay plugin installed in the sibling directory.
import audiobookbay, { resolveMagnetFor } from "../audiobookbay/index.mjs";

import { wrap } from "./wrap.mjs";

export default wrap(audiobookbay, resolveMagnetFor);
