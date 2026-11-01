export type AuthCapabilities = {
  auth_mode: 'local';
  email: boolean;
  google: false;
  apple: false;
  phone: false;
  email_delivery: 'capture' | 'smtp';
};
