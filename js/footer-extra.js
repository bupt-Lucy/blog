function show_runtime() {
  const start = new Date("2025/05/29 22:00:00");
  const now = new Date();
  const diff = now - start;

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  const runtimeText = `本站已运行 ${days} 天 ${hours} 小时 ${minutes} 分 ${seconds} 秒`;

  const el = document.getElementById('runtime_span');
  if (el) el.innerText = runtimeText;
}

show_runtime();
setInterval(show_runtime, 1000);
