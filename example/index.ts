import { CustomEventConnector, EventBus, HttpConnector } from "../src";

const bus = new EventBus();

const emiter = new CustomEventConnector(bus);
const httpConnector = new HttpConnector(bus);

emiter.on({ event: "ORDER_CANCELED" }, async (event: any) => {});

httpConnector.on({ method: "GET", path: "/test" }, (event: any) => {
  emiter.dispatch("ORDER_CANCELED", { orderNumber: "234234" });
  event.res.end("Hello World!");
});

bus.start();
