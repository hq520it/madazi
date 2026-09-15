import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import Home from './pages/Home.vue';
import './index.css';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Home }
  ]
});

createApp(Home).use(router).mount('#app');
