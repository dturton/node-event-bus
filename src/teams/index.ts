import axios from "axios";

import { TeamsChannelWebhook } from "../types";

class TeamsConnector {
  teamsChannels: Map<string, string>;

  constructor() {
    this.teamsChannels = new Map();
  }

  registerChannels(options: TeamsChannelWebhook[]): void {
    options.forEach((each) => {
      this.teamsChannels.set(each.channelName, each.url);
    });
  }

  getTeamsChannels() {
    return this.teamsChannels;
  }

  async sendMessage(channelName: string, message: string): Promise<void> {
    const webHookUrl = this.teamsChannels.get(channelName);

    try {
      const response = await axios.post(webHookUrl, { text: message });
      console.log(response.data);
    } catch (err) {
      console.log(err);
      return err;
    }
  }
}

export default TeamsConnector;
