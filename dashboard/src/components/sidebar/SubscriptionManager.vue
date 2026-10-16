<template>
  <a
    class="subscription-manager base-container hover:bg-base-300/70 flex items-center gap-2 px-3 py-2 transition-colors"
    :class="collapsed ? 'justify-center' : ''"
    :href="subscriptionUrl"
    target="_blank"
    rel="noopener noreferrer"
    :aria-label="t('subscriptionManager')"
    :title="collapsed ? t('subscriptionManager') : undefined"
  >
    <ArrowPathRoundedSquareIcon class="size-5 shrink-0" />
    <span
      v-if="!collapsed"
      class="truncate text-sm font-medium"
    >
      {{ t('subscriptionManager') }}
    </span>
    <ArrowTopRightOnSquareIcon
      v-if="!collapsed"
      class="ml-auto size-4 opacity-60"
    />
  </a>
</template>

<script setup lang="ts">
import { ArrowPathRoundedSquareIcon, ArrowTopRightOnSquareIcon } from '@heroicons/vue/24/outline'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

defineProps<{ collapsed: boolean }>()

const { t } = useI18n()
const subscriptionUrl = computed(
  () => `${window.location.protocol}//${window.location.hostname}:23002/`,
)
</script>
