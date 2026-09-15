<template>
  <div class="container">
    <h1>Items</h1>
    <form @submit.prevent="addItem">
      <input v-model="form.name" placeholder="名称" required />
      <input v-model="form.description" placeholder="描述" />
      <button type="submit">添加</button>
    </form>
    <ul>
      <li v-for="item in items" :key="item.id">
        <strong>{{ item.name }}</strong>
        <span v-if="item.description"> - {{ item.description }}</span>
        <button @click="deleteItem(item.id)">删除</button>
      </li>
    </ul>
    <p v-if="items.length === 0">暂无数据</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api';

interface Item {
  id: string;
  name: string;
  description?: string;
}

const items = ref<Item[]>([]);
const form = ref({ name: '', description: '' });

async function load() {
  const res = await api.get('/items');
  items.value = res.data.data || [];
}

async function addItem() {
  await api.post('/items', { ...form.value });
  form.value = { name: '', description: '' };
  await load();
}

async function deleteItem(id: string) {
  await api.delete('/items/' + id);
  await load();
}

onMounted(load);
</script>

<style scoped>
.container { max-width: 600px; margin: 0 auto; padding: 20px; }
form { display: flex; gap: 8px; margin-bottom: 16px; }
input { flex: 1; padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; }
button { padding: 6px 14px; cursor: pointer; }
ul { list-style: none; padding: 0; }
li { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid #eee; }
li button { margin-left: auto; }
</style>
