import type { v1 } from '@imeal/contracts';

const TIME_ZONE = 'Asia/Ho_Chi_Minh';

type NotificationKind = v1.NotificationKind;

export type NotificationCopy = {
  vi: { title: string; body: string };
  en: { title: string; body: string };
};

function dateValue(value: unknown): Date {
  const text = String(value ?? '');
  return new Date(`${text}T12:00:00.000Z`);
}

export function formatNotificationDate(
  value: unknown,
  locale: 'vi' | 'en',
): string {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(dateValue(value));
}

export function displayNotificationName(
  user: { name?: string | null; email?: string | null } | null | undefined,
): string {
  return user?.name?.trim() || user?.email?.trim() || 'nhân viên';
}

function nameForLocale(value: unknown, locale: 'vi' | 'en'): string {
  const name = String(value ?? '').trim();
  return name === 'nhân viên' ? (locale === 'vi' ? 'nhân viên' : 'employee') : name || (locale === 'vi' ? 'nhân viên' : 'employee');
}

function countLabel(count: number, locale: 'vi' | 'en'): string {
  if (locale === 'vi') return String(count);
  return `${count} unregistered day${count === 1 ? '' : 's'}`;
}

function mealCountLabel(count: number, locale: 'vi' | 'en'): string {
  if (locale === 'vi') return String(count);
  return `${count} meal${count === 1 ? '' : 's'}`;
}

function renderLocale(
  kind: NotificationKind,
  payload: Readonly<Record<string, unknown>>,
  locale: 'vi' | 'en',
): { title: string; body: string } {
  const date = (value: unknown) => formatNotificationDate(value, locale);
  switch (kind) {
    case 'LEGACY_MESSAGE':
      return locale === 'vi'
        ? { title: 'Thông báo', body: '' }
        : { title: 'Notification', body: '' };
    case 'REGISTRATION_OPENED':
      return locale === 'vi'
        ? {
            title: 'Đã mở đăng ký suất ăn',
            body: `Thực đơn tuần ${date(payload.weekStart)} đã sẵn sàng. Hãy chọn các ngày bạn muốn dùng suất.`,
          }
        : {
            title: 'Meal registration is open',
            body: `The menu for the week of ${date(payload.weekStart)} is ready. Choose the days you want a meal.`,
          };
    case 'REGISTRATION_REMINDER': {
      const count = Array.isArray(payload.remainingMealDates)
        ? payload.remainingMealDates.length
        : 0;
      return locale === 'vi'
        ? {
            title: 'Nhắc đăng ký tuần tới',
            body: `Bạn còn ${countLabel(count, locale)} ngày chưa đăng ký. Hãy kiểm tra trước giờ chốt của từng ngày.`,
          }
        : {
            title: "Next week's registration",
            body: `You still have ${countLabel(count, locale)}. Review them before each day's cutoff.`,
          };
    }
    case 'PICKUP_REMINDER': {
      const count = Number(payload.registrationCount ?? 0);
      return locale === 'vi'
        ? {
            title: 'Nhắc nhận suất ăn',
            body: `Bạn còn ${mealCountLabel(count, locale)} suất chưa nhận hôm nay. Thời gian nhận kết thúc lúc 13:30.`,
          }
        : {
            title: 'Meal pickup reminder',
            body: `You still have ${mealCountLabel(count, locale)} to collect today. Pickup closes at 13:30.`,
          };
    }
    case 'DELEGATION_REQUESTED':
      return locale === 'vi'
        ? {
            title: 'Yêu cầu nhận hộ mới',
            body: `${nameForLocale(payload.counterpartName, locale)} muốn bạn nhận hộ suất ngày ${date(payload.mealDate)}.`,
          }
        : {
            title: 'New pickup request',
            body: `${nameForLocale(payload.counterpartName, locale)} asked you to collect their meal for ${date(payload.mealDate)}.`,
          };
    case 'DELEGATION_ACCEPTED':
      return locale === 'vi'
        ? {
            title: 'Đã chấp nhận nhận hộ',
            body: `${nameForLocale(payload.counterpartName, locale)} đã nhận lời lấy suất ngày ${date(payload.mealDate)}.`,
          }
        : {
            title: 'Pickup request accepted',
            body: `${nameForLocale(payload.counterpartName, locale)} accepted your pickup request for ${date(payload.mealDate)}.`,
          };
    case 'DELEGATION_DECLINED':
      return locale === 'vi'
        ? {
            title: 'Đã từ chối nhận hộ',
            body: `${nameForLocale(payload.counterpartName, locale)} đã từ chối lấy suất ngày ${date(payload.mealDate)}.`,
          }
        : {
            title: 'Pickup request declined',
            body: `${nameForLocale(payload.counterpartName, locale)} declined your pickup request for ${date(payload.mealDate)}.`,
          };
    case 'DELEGATION_REVOKED': {
      const cancelled = payload.reason === 'REGISTRATION_CANCELLED';
      return locale === 'vi'
        ? {
            title: 'Ủy quyền đã thu hồi',
            body: `Yêu cầu nhận hộ từ ${nameForLocale(payload.counterpartName, locale)} cho ngày ${date(payload.mealDate)} đã được thu hồi${cancelled ? ' vì suất đã hủy' : ''}.`,
          }
        : {
            title: 'Pickup delegation revoked',
            body: `The pickup request from ${nameForLocale(payload.counterpartName, locale)} for ${date(payload.mealDate)} was revoked${cancelled ? ' because the registration was canceled' : ''}.`,
          };
    }
    case 'PROXY_PICKUP_COMPLETED':
      return locale === 'vi'
        ? {
            title: 'Suất đã được nhận hộ',
            body: `${nameForLocale(payload.delegateName, locale)} đã nhận suất của bạn cho ngày ${date(payload.mealDate)}.`,
          }
        : {
            title: 'Meal collected by delegate',
            body: `${nameForLocale(payload.delegateName, locale)} collected your meal for ${date(payload.mealDate)}.`,
          };
    case 'REGISTERED_MENU_CHANGED':
      return locale === 'vi'
        ? {
            title: 'Thực đơn đã thay đổi',
            body: `Thực đơn ngày ${date(payload.mealDate)} đã được cập nhật. Đăng ký của bạn vẫn được giữ.`,
          }
        : {
            title: 'Menu updated',
            body: `The menu for ${date(payload.mealDate)} was updated. Your registration is unchanged.`,
          };
    case 'NO_SHOW_PENALTY_CREATED':
      return locale === 'vi'
        ? {
            title: 'Phạt không nhận suất',
            body: `Bạn bị phạt 50.000đ do không nhận suất ngày ${date(payload.mealDate)}.`,
          }
        : {
            title: 'No-show penalty',
            body: `A VND 50,000 penalty was added because your meal for ${date(payload.mealDate)} was not collected.`,
          };
  }
}

export function renderNotificationCopy(
  kind: NotificationKind,
  payload: Readonly<Record<string, unknown>>,
): NotificationCopy {
  return {
    vi: renderLocale(kind, payload, 'vi'),
    en: renderLocale(kind, payload, 'en'),
  };
}
