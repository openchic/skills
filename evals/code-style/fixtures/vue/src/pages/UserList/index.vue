<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fetchUsers } from './api'

const props = defineProps<{ teamId: string }>()
const users = ref<{ id: string; name: string }[]>([])
const isLoading = ref(true)
const query = ref('')
const error = ref<string | null>(null)

watch(() => props.teamId, async (teamId, _, onCleanup) => {
  let isActive = true
  onCleanup(() => { isActive = false })
  isLoading.value = true
  error.value = null
  try {
    const result = await fetchUsers(teamId)
    if (isActive) users.value = result
  } catch {
    if (isActive) error.value = 'Unable to load users'
  } finally {
    if (isActive) isLoading.value = false
  }
}, { immediate: true })

const visibleUsers = computed(() => users.value.filter(user =>
  user.name.toLowerCase().includes(query.value.toLowerCase())))
</script>

<template>
  <p v-if="isLoading">Loading</p>
  <p v-else-if="error" role="alert">{{ error }}</p>
  <main v-else>
    <h1>Users</h1>
    <label>Search<input v-model="query" aria-label="Search" /></label>
    <ul><li v-for="user in visibleUsers" :key="user.id">{{ user.name }}</li></ul>
  </main>
</template>
