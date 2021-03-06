import express, {
  Express,
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";
import { nanoid } from "nanoid";
import { Logger, LoggerOptions } from "winston";
import http from "http";
import { MemoryStoreAdapter, PersistentStoreAdapter } from "./persistency";
import {
  BaseConnector,
  EventConfiguration,
  BaseHttpConnector,
} from "./connectors";
import { createLogger } from "./Logger";

export interface Handler {
  handle: (event: any, app: EventBus) => void;
  id: string;
}

export default class EventBus {
  httpDelegates: { [path: string]: any };
  registry: {
    connectors: { [url: string]: BaseConnector };
    handlers: { [id: string]: Handler[] };
    common: { persistentStore?: any; webserver?: Express };
  };
  httpServer?: http.Server;
  port: number;
  middleware: RequestHandler[] = [
    express.json(),
    express.urlencoded({ extended: true }),
  ];
  logger: Logger;

  constructor(server?: Express, loggerOptions?: LoggerOptions) {
    this.port = parseInt(<string>process.env.PORT, 10) || 8000;
    this.registry = {
      connectors: {},
      handlers: {},
      common: { webserver: server },
    };
    this.logger = createLogger(loggerOptions);
    this.httpDelegates = {};
    this.logger.info("EventBus Initializing");
  }

  addMiddleware(middleware: RequestHandler) {
    this.middleware.push(middleware);
  }

  private prepareWebServer(): Express {
    if (!this.registry.common.webserver) {
      this.registry.common.webserver = express();
      this.registry.common.webserver.use(this.middleware);
    }

    return this.registry.common.webserver;
  }

  register(connector: BaseConnector): EventBus {
    this.registry.connectors[connector.id] = connector;

    return this;
  }

  async unregister(connector: BaseConnector): Promise<void> {
    await connector.stop();
    delete this.registry.connectors[connector.id];
  }

  getConnector(connectorId: BaseConnector["id"]): BaseConnector {
    if (!this.registry.connectors[connectorId]) {
      this.logger.error(`Could not find connector [id=${connectorId}]`);
    }
    return this.registry.connectors[connectorId];
  }

  registerHTTPDelegate(path: string, delegate: BaseHttpConnector): EventBus {
    this.httpDelegates[path] =
      this.httpDelegates[path] || new HttpMultiplexer(path);
    this.httpDelegates[path].delegates.push(delegate);
    return this;
  }

  //we might to add a fine tuned method in the future that just removes one delegete
  unregisterHTTPDelegate(path: string): void {
    const httpMultiplexer = this.httpDelegates[path];
    if (httpMultiplexer) {
      httpMultiplexer.delegates = [];
    }
  }

  when(
    eventConfiguration: EventConfiguration,
    handler: (() => void) | Handler
  ): EventBus {
    const handlerWrapper =
      typeof handler === "object"
        ? handler
        : {
            handle: handler,
            id: nanoid(),
          };
    if (this.registry.handlers[eventConfiguration.id]) {
      this.registry.handlers[eventConfiguration.id].push(handlerWrapper);
    } else {
      this.registry.handlers[eventConfiguration.id] = [handlerWrapper];
    }
    this.logger.info("EventBus Registering event", eventConfiguration.id);

    return this;
  }

  start(callback?: () => void): void {
    // Start all connectors
    Object.values(this.registry.connectors).forEach((connector) =>
      connector.start()
    );

    // Start the webserver if we have http delegates
    if (Object.keys(this.httpDelegates).length) {
      const webserver = this.prepareWebServer();

      const specificPaths = Object.keys(this.httpDelegates).filter(
        (p) => !p.includes(":")
      );
      const genericPathsOrdered = Object.keys(this.httpDelegates)
        .filter((p) => p.includes(":"))
        .sort()
        .reverse();

      // Moves all generic routes (containing :) at the end,  with /specific/generic first (e.g. /foo/:id before /:bar)
      specificPaths.concat(genericPathsOrdered).forEach((path) => {
        const httpMultiplexer = this.httpDelegates[path];
        webserver.all(path, httpMultiplexer.handle.bind(httpMultiplexer));
      });

      webserver.all("/events/webhooks/*", (req, res) => {
        const errorMessage = `Webhook not registered`;
        this.logger.info(`${errorMessage} for ${req.method} ${req.url}`);
        return res.status(501).send(errorMessage);
      });
    }

    callback && callback();
  }

  async handleEvent(
    eventId: EventConfiguration["id"],
    event: any
  ): Promise<boolean> {
    const eventHandlers = this.registry.handlers[eventId];
    if (!eventHandlers || eventHandlers.length === 0) {
      return false;
    }

    let handled = true;
    for (const handler of eventHandlers) {
      handled &&= await this.onHandleEvent(handler, event);
    }

    return handled;
  }

  async onHandleEvent(handler: Handler, event: any): Promise<boolean> {
    this.logger.defaultMeta = { handlerId: handler.id };
    try {
      await handler.handle(event, this);
      return true;
    } catch (error) {
      this.logger.error((error as Error).stack);
      return false;
    } finally {
      this.logger.defaultMeta = {};
    }
  }

  setPersistentStore(adapter: PersistentStoreAdapter) {
    this.registry.common.persistentStore = adapter;
    return adapter;
  }

  getPersistentStore() {
    return (
      this.registry.common.persistentStore ||
      this.setPersistentStore(new MemoryStoreAdapter())
    );
  }

  getLogger(): Logger {
    return this.logger;
  }
}

export { EventBus };

class HttpMultiplexer {
  delegates: BaseHttpConnector[];
  originalPath: string;
  constructor(originalPath: string) {
    this.originalPath = originalPath;
    this.delegates = [];
  }
  async handle(
    req: Request & { originalPath: string },
    res: Response,
    next: NextFunction
  ) {
    req.originalPath = this.originalPath;
    let handled = false;

    if (this.delegates.length > 0) {
      for (const delegate of this.delegates) {
        if (handled) {
          break;
        }
        handled = await delegate.handle(req, res, next);
      }
    }

    if (!handled) {
      next();
    }
  }
}
