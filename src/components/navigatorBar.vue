<script setup lang="ts">
import { player } from '@/data/player'
import { mainTabsList } from '@/app/navigation'
</script>
<template>
  <div id="navigatorBar">
    <button
      v-for="tab in mainTabsList"
      :key="tab.id"
      :class="[
        'mainTab',
        //元层标签使用独立主题类(如无限→theme-infinity),不再使用统一的--meta配色
        tab.meta ? `theme-${tab.id}` : '',
        { selected: player.mainTab == tab.id },
      ]"
      @click="player.mainTab = tab.id"
    >
      {{ tab.name }}
    </button>
  </div>
</template>
<style lang="css" scoped>
div#navigatorBar {
  border-left: 2px solid var(--dim);
  border-right: 2px solid var(--dim);
  width: 150px;
  height: 100%;
  flex: 0 0 auto;
  box-sizing: border-box;
}
/*窄屏或矮屏(横屏):横向排列，按钮可换行，高度至少为固定值*/
@media (max-width: 700px), (max-height: 500px) {
  div#navigatorBar {
    width: 100%;
    height: auto;
    min-height: 40px;
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    border: none;
    border-bottom: 2px solid var(--dim);
  }
  button.mainTab {
    width: auto;
    flex: 0 0 auto;
    height: 36px;
    padding: 0 8px;
    font-size: 14px;
    white-space: nowrap;
  }
}
</style>
