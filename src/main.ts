import { createApp } from 'vue'
import App from './App.vue'
import { autoSaveLoop, mainLoop } from '@/app/core'
import { localLoad, localSave, loadSlotChoice } from '@/save/save'
import { seedRng } from '@/save/rng'
import { player } from '@/data/player'
import '@/compute/buyables'
import '@/meta/infinity'
import { loadSettings, applyTheme } from '@/app/settings'
loadSettings()
applyTheme()
loadSlotChoice()
createApp(App).mount('#app')
if (!localLoad()) localSave()
//确保随机数已按存档状态播种(新档首次启动时localLoad失败,此处兜底)
seedRng(player.rngState ?? player.seed)
setInterval(autoSaveLoop, 1000)
mainLoop()
