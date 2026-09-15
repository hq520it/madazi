<template>
  <view class="container">
    <view class="header">
      <text class="title">项目首页</text>
    </view>

    <view class="form card">
      <view class="form-item">
        <input
          v-model="form.name"
          placeholder="名称"
          class="input"
          maxlength="50"
        />
      </view>
      <view class="form-item">
        <textarea
          v-model="form.description"
          placeholder="描述（可选）"
          class="textarea"
          maxlength="500"
        />
      </view>
      <button class="btn-primary" :disabled="!form.name" @click="addItem">
        添加
      </button>
    </view>

    <view class="list">
      <view v-if="loading" class="loading">加载中…</view>
      <view v-else-if="items.length === 0" class="empty">暂无数据</view>
      <view v-else v-for="item in items" :key="item.id" class="card item">
        <view class="item-content">
          <text class="item-name">{{ item.name }}</text>
          <text v-if="item.description" class="item-desc">{{ item.description }}</text>
        </view>
        <button class="btn-danger" size="mini" @click="removeItem(item.id)">
          删除
        </button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'

interface Item {
  id: string
  name: string
  description?: string
}

// ★ H5 预览：baseURL 必须带 base 前缀（import.meta.env.BASE_URL），
//   禁止 localhost 硬编码（预览下 localhost 指向用户本机，打不到容器）
const BASE_URL = import.meta.env.BASE_URL + 'api'

const items = ref<Item[]>([])
const loading = ref(false)
const form = reactive({
  name: '',
  description: ''
})

const request = <T,>(method: string, url: string, data?: unknown): Promise<T> => {
  return new Promise((resolve, reject) => {
    uni.request({
      url: BASE_URL + url,
      method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
      data,
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T)
        } else {
          reject(new Error(`HTTP ${res.statusCode}`))
        }
      },
      fail: (err) => reject(err)
    })
  })
}

const loadItems = async () => {
  loading.value = true
  try {
    const list = await request<Item[]>('GET', '/items')
    items.value = list
  } catch (e) {
    uni.showToast({ title: '加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

const addItem = async () => {
  if (!form.name.trim()) {
    uni.showToast({ title: '请输入名称', icon: 'none' })
    return
  }
  try {
    await request<Item>('POST', '/items', {
      name: form.name.trim(),
      description: form.description.trim() || undefined
    })
    form.name = ''
    form.description = ''
    await loadItems()
    uni.showToast({ title: '添加成功', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: '添加失败', icon: 'none' })
  }
}

const removeItem = async (id: string) => {
  try {
    await request<void>('DELETE', `/items/${id}`)
    await loadItems()
    uni.showToast({ title: '已删除', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: '删除失败', icon: 'none' })
  }
}

onMounted(() => {
  loadItems()
})

onShow(() => {
  // 返回页面时刷新
  loadItems()
})
</script>

<style lang="scss" scoped>
.container {
  padding: 24rpx;
}

.header {
  margin-bottom: 24rpx;
}

.title {
  font-size: 36rpx;
  font-weight: 600;
  color: #333;
}

.card {
  background-color: #fff;
  border-radius: 24rpx;
  padding: 24rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.04);
}

.form {
  display: flex;
  flex-direction: column;
}

.form-item {
  margin-bottom: 16rpx;
}

.input,
.textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 16rpx 24rpx;
  font-size: 28rpx;
  background-color: #f5f5f5;
  border-radius: 24rpx;
}

.textarea {
  min-height: 120rpx;
}

.btn-primary {
  margin-top: 8rpx;
  background-color: #007aff;
  color: #fff;
  border-radius: 24rpx;
  font-size: 30rpx;
  line-height: 80rpx;
}

.btn-primary[disabled] {
  background-color: #a0c8ff;
  color: #fff;
}

.list {
  margin-top: 8rpx;
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.item-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  margin-right: 16rpx;
}

.item-name {
  font-size: 30rpx;
  color: #333;
  font-weight: 500;
}

.item-desc {
  margin-top: 8rpx;
  font-size: 26rpx;
  color: #999;
}

.btn-danger {
  background-color: #dd524d;
  color: #fff;
  font-size: 24rpx;
  border-radius: 24rpx;
}

.loading,
.empty {
  text-align: center;
  color: #999;
  font-size: 28rpx;
  padding: 60rpx 0;
}
</style>
