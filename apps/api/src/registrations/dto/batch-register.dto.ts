export class BatchRegisterDto {
  registrations: {
    mealDate: string; // ISO string YYYY-MM-DD
    status: 'ACTIVE' | 'CANCELLED';
  }[];
}
