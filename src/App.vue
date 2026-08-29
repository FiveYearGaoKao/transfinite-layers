<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { player } from '@/data/player'
import { getMetaLayers } from '@/meta/registry'
import { settings } from '@/app/settings'
import { initHotkeys, disposeHotkeys } from '@/app/hotkeys'
import layers from './components/features/layers.vue'
import options from './components/features/options.vue'
import achievements from './components/features/achievements.vue'
import knowledge from './components/features/knowledge.vue'
import challenges from './components/features/challenges.vue'
import automation from './components/features/automation.vue'
import newsBar from './components/newsBar.vue'
import resourceBar from './components/resourceBar.vue'
import navigatorBar from './components/navigatorBar.vue'
import logBar from './components/logBar.vue'
import toolBar from './components/toolBar.vue'
import DialogHost from './components/dialog.vue'

onMounted(initHotkeys)
onUnmounted(disposeHotkeys)
</script>

<template>
  <div id="main">
    <div id="header">
      <newsBar />
      <resourceBar />
    </div>
    <div id="center">
      <navigatorBar />
      <div id="realMain">
        <layers v-if="player.mainTab == 'layers'" />
        <options v-if="player.mainTab == 'options'" />
        <achievements v-if="player.mainTab == 'achievements'" />
        <knowledge v-if="player.mainTab == 'knowledge'" />
        <challenges v-if="player.mainTab == 'challenges'" />
        <automation v-if="player.mainTab == 'automation'" />
        <template v-for="m in getMetaLayers()" :key="m.id">
          <component :is="m.component" v-if="player.mainTab == m.id && m.component" />
        </template>
      </div>
      <logBar v-if="settings.showLog" />
    </div>
    <div id="footer">
      <toolBar v-if="settings.showToolBar" />
    </div>
  </div>
  <DialogHost />
</template>

<style scoped>
div#main {
  position: absolute;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
div#header {
  flex: 0 0 auto;
}
div#center {
  flex: 1 1 auto;
  height: 0px;
  min-height: 0;
  display: flex;
  flex-direction: row;
}
div#center > * {
  min-width: 0;
}
div#realMain {
  flex: 1 1 0;
  margin: 0px;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
}
div#footer {
  flex: 0 0 auto;
}
/*窄屏或矮屏(横屏):中区改为纵向排列，导航栏在上、日志栏在下*/
@media (max-width: 700px), (max-height: 500px) {
  div#center {
    flex-direction: column;
    height: auto;
  }
  div#realMain {
    flex: 1 1 auto;
  }
}
</style>
