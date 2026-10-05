// Home page script: init the locale layer, then wire the share dialog.
import { initI18n } from "../shared/i18n/index.ts";
import { wireShareDialog } from "../shared/share-dialog.ts";

await initI18n();

document.getElementById("share-open")!.addEventListener("click", wireShareDialog());
