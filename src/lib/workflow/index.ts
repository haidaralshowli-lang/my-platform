// نقطة الدخول الوحيدة لمحرك سير العمل: تضمن تسجيل جميع الانتقالات قبل الاستخدام
import "./transitions";

export { applyTransition, availableTransitions, getTransition, lockViolation, SYSTEM_ACTOR } from "./engine";
export { hasActiveReport, missingRegistrationFields } from "./transitions";
