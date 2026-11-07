export interface ProfileStrengthField {
  key: string;
  weight: number;
  label: string;
  why: string;
  cta: string;
}
export interface ProfileStrength {
  percent: number;
  label: string;
  done: string[];
  missing: ProfileStrengthField[];
  next: ProfileStrengthField | null;
}
export declare function profileStrength(profile: Record<string, any> | null | undefined): ProfileStrength;
export declare const PROFILE_STRENGTH_FIELDS: ProfileStrengthField[];
