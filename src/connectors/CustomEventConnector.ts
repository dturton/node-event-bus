import BaseConnector from "./BaseConnector";
import EventConfiguration from "./EventConfiguration";

export interface CustomEventConnectorEventOptions {
  event: string;
}

export type Handler = {
  handle: (event?: EventConfiguration) => void;
  id: string;
};

export default class CustomEventConnector extends BaseConnector<
  null,
  CustomEventConnectorEventOptions
> {
  on(
    options: CustomEventConnectorEventOptions,
    handler: unknown,
    eventId?: string
  ): EventConfiguration {
    if (!eventId) {
      eventId = `Event/${options.event}/${this.id}`;
    }
    const event = new EventConfiguration(eventId, this, options);
    this.eventConfigurations[event.id] = event;
    this.app.when(event, handler as Handler);

    return event;
  }

  async dispatch(event: string, payload: unknown): Promise<void> {
    const eventsToExecute = Object.values(this.eventConfigurations).filter(
      (e) => e.options.event === event
    );

    for (const event of eventsToExecute) {
      await this.app.handleEvent(event.id, {
        ...event,
        payload,
      });
    }
  }
}
