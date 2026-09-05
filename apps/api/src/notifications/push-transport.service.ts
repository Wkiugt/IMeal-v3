import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

@Injectable()
export class PushTransportService {
  private expo = new Expo();
  private prisma = new PrismaClient();
  private logger = new Logger(PushTransportService.name);

  async registerToken(userId: string, token: string) {
    if (!Expo.isExpoPushToken(token)) {
      throw new Error(`Push token ${token} is not a valid Expo push token`);
    }

    await this.prisma.pushDevice.upsert({
      where: { token },
      update: { userId },
      create: { userId, token },
    });
  }

  async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    data?: any,
  ) {
    // 1. Fetch devices for user
    const devices = await this.prisma.pushDevice.findMany({
      where: { userId },
    });

    if (devices.length === 0) {
      return;
    }

    const messages: ExpoPushMessage[] = [];
    for (const device of devices) {
      if (!Expo.isExpoPushToken(device.token)) {
        this.logger.warn(`Invalid token found in db: ${device.token}`);
        continue;
      }
      messages.push({
        to: device.token,
        sound: 'default',
        title,
        body,
        data,
      });
    }

    const chunks = this.expo.chunkPushNotifications(messages);
    const ticketsWithMessages: {
      ticket: ExpoPushTicket;
      message: ExpoPushMessage;
    }[] = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        ticketChunk.forEach((ticket, idx) => {
          ticketsWithMessages.push({ ticket, message: chunk[idx] });
        });
      } catch (error) {
        this.logger.error('Error sending push notification chunk', error);
      }
    }

    // Process tickets to handle unregistered tokens
    const tokensToRemove: string[] = [];
    ticketsWithMessages.forEach(({ ticket, message }) => {
      if (ticket.status === 'error') {
        if (ticket.details && ticket.details.error === 'DeviceNotRegistered') {
          // Token is no longer valid
          tokensToRemove.push(message.to as string);
        } else {
          this.logger.error(
            `Error sending push to ${message.to}: ${ticket.message}`,
          );
        }
      }
    });

    if (tokensToRemove.length > 0) {
      await this.prisma.pushDevice.deleteMany({
        where: { token: { in: tokensToRemove } },
      });
      this.logger.log(
        `Removed ${tokensToRemove.length} unregistered push tokens`,
      );
    }
  }
}
