if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}

const script = document.createElement("script");
script.src = "./src/standalone.js";
script.defer = false;
document.body.appendChild(script);

