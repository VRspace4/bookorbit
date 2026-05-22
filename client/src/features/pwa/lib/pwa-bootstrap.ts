import './install-prompt-init'
import { usePwaServiceWorker } from '../composables/usePwaServiceWorker'

void usePwaServiceWorker().register()
