import type { Theme } from './cyber-domain';

export const themeCookie = 'cyberapply_theme';
export const themeChoices = [['paper','Paper'],['midnight','Midnight'],['ocean','Ocean'],['forest','Forest'],['ember','Ember']] as const;
export function parseTheme(value: string | undefined): Theme | undefined {
  return themeChoices.some(([theme])=>theme===value) ? value as Theme : undefined;
}
