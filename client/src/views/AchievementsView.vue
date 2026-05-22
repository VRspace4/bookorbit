<script setup lang="ts">
import { Trophy } from 'lucide-vue-next'
import AchievementsPage from '@/features/achievements/components/AchievementsPage.vue'
</script>

<template>
  <main class="flex flex-col gap-6 py-4 sm:py-6">
    <div class="flex items-center gap-3">
      <div class="flex size-9 items-center justify-center rounded-lg bg-primary/10">
        <Trophy class="size-4.5 text-primary" />
      </div>
      <div>
        <h1 class="text-xl font-semibold tracking-tight text-foreground">Achievements</h1>
        <p class="text-muted-foreground text-xs">Track your reading milestones and unlock rewards</p>
      </div>
    </div>

    <AchievementsPage />
  </main>
</template>
