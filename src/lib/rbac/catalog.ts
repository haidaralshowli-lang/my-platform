// فهرس الصلاحيات والأدوار الأساسية.
// هذا الملف مصدر تعريف الصلاحيات (تُزرع في قاعدة البيانات)، أما ربط الأدوار بالصلاحيات
// فيُقرأ دائماً من قاعدة البيانات وقت التنفيذ ويمكن تعديله من إدارة الصلاحيات.

export const PERMISSIONS = {
  // لوحة المعلومات والاطلاع
  "dashboard.view": { nameAr: "عرض لوحة المعلومات", groupAr: "عام" },
  "violation.view": { nameAr: "الاطلاع على المخالفات ضمن النطاق", groupAr: "المخالفات" },
  "scope.central": { nameAr: "اطلاع مركزي على جميع المحافظات", groupAr: "المخالفات" },
  "violation.create": { nameAr: "تسجيل مخالفة جديدة", groupAr: "المخالفات" },
  "violation.edit": { nameAr: "تعديل بيانات المخالفة قبل المصادقة", groupAr: "المخالفات" },
  "violation.submit": { nameAr: "إحالة المخالفة للمصادقة", groupAr: "المخالفات" },
  "attachment.upload": { nameAr: "رفع المرفقات", groupAr: "المرفقات" },
  "attachment.view_confidential": { nameAr: "الاطلاع على المرفقات السرية", groupAr: "المرفقات" },
  "attachment.withdraw": { nameAr: "سحب مرفق معتمد بمسار رسمي", groupAr: "المرفقات" },

  // المصادقات
  "approval.final_registration": { nameAr: "المصادقة النهائية على المخالفة", groupAr: "المصادقات" },
  "technical.prepare": { nameAr: "إعداد الموقف الفني", groupAr: "الموقف الفني" },
  "technical.review": { nameAr: "مراجعة الموقف الفني والمصادقة عليه", groupAr: "الموقف الفني" },
  "legal.prepare": { nameAr: "إعداد الرأي القانوني", groupAr: "الدائرة القانونية" },
  "legal.approve": { nameAr: "المصادقة القانونية", groupAr: "الدائرة القانونية" },

  // الإنذار
  "warning.approve_issue": { nameAr: "الموافقة على إصدار الإنذار", groupAr: "الإنذارات" },
  "warning.prepare": { nameAr: "إعداد الإنذار من القالب", groupAr: "الإنذارات" },
  "warning.upload_signed": { nameAr: "رفع نسخة الإنذار الموقعة", groupAr: "الإنذارات" },
  "template.manage": { nameAr: "إدارة قوالب الإنذارات", groupAr: "الإنذارات" },

  // التبليغ والمدد
  "delivery.record": { nameAr: "تسجيل التبليغ ووصل الاستلام", groupAr: "التبليغات" },
  "delivery.correct_receipt": { nameAr: "تصحيح تاريخ الاستلام المسجل", groupAr: "التبليغات" },
  "deadline.view": { nameAr: "متابعة المدد القانونية", groupAr: "المدد القانونية" },
  "deadline.rules_manage": { nameAr: "إدارة قواعد احتساب المدد", groupAr: "المدد القانونية" },
  "extension.record": { nameAr: "تسجيل طلب تمديد", groupAr: "المدد القانونية" },
  "extension.decide": { nameAr: "البت في طلبات التمديد", groupAr: "المدد القانونية" },

  // الاستجابات
  "response.record": { nameAr: "تسجيل استجابة", groupAr: "الاستجابات" },
  "response.technical_verify": { nameAr: "التحقق الفني من الاستجابة", groupAr: "الاستجابات" },
  "response.legal_decide": { nameAr: "قرار الاستجابة القانونية", groupAr: "الاستجابات" },
  "response.decide": { nameAr: "قرار كفاية الاستجابة", groupAr: "الاستجابات" },
  "financial.view": { nameAr: "الاطلاع على البيانات المالية", groupAr: "المالية" },
  "financial.record": { nameAr: "تسجيل الاستجابات المالية والتسديدات", groupAr: "المالية" },
  "financial.approve_overpayment": { nameAr: "اعتماد تجاوز المبلغ المستحق", groupAr: "المالية" },
  "removal.record": { nameAr: "تسجيل إزالة المخالفة", groupAr: "الاستجابات" },
  "removal.approve": { nameAr: "اعتماد إزالة المخالفة", groupAr: "الاستجابات" },
  "objection.record": { nameAr: "تسجيل الاعتراضات والطعون", groupAr: "الاعتراضات" },
  "objection.decide": { nameAr: "تسجيل قرار الاعتراض أو الطعن", groupAr: "الاعتراضات" },

  // عدم الاستجابة والدعوى
  "nonresponse.initiate": { nameAr: "بدء إجراء عدم الاستجابة", groupAr: "الدعوى الجزائية" },
  "nonresponse.approve": { nameAr: "اعتماد عدم الاستجابة", groupAr: "الدعوى الجزائية" },
  "criminal.view": { nameAr: "الاطلاع على ملفات الدعوى", groupAr: "الدعوى الجزائية" },
  "criminal.manage": { nameAr: "إدارة ملف الدعوى الجزائية", groupAr: "الدعوى الجزائية" },
  "judgment.record": { nameAr: "تسجيل الحكم القضائي", groupAr: "الدعوى الجزائية" },
  "judgment.approve": { nameAr: "اعتماد بيانات الحكم", groupAr: "الدعوى الجزائية" },

  // الإغلاق
  "closure.request": { nameAr: "طلب إغلاق المخالفة", groupAr: "الإغلاق" },
  "closure.approve": { nameAr: "اعتماد إغلاق المخالفة", groupAr: "الإغلاق" },
  "violation.reopen": { nameAr: "إعادة فتح مخالفة مغلقة", groupAr: "الإغلاق" },

  // المكتبة والتقارير والإدارة
  "legal_library.view": { nameAr: "الاطلاع على المكتبة القانونية", groupAr: "المكتبة القانونية" },
  "legal_library.manage": { nameAr: "إدارة المكتبة القانونية", groupAr: "المكتبة القانونية" },
  "reports.view": { nameAr: "عرض التقارير", groupAr: "التقارير" },
  "reports.performance": { nameAr: "تقارير أداء الموظفين", groupAr: "التقارير" },
  "audit.view": { nameAr: "الاطلاع على سجل التدقيق", groupAr: "الإدارة" },
  "users.manage": { nameAr: "إدارة المستخدمين", groupAr: "الإدارة" },
  "roles.manage": { nameAr: "إدارة الأدوار والصلاحيات", groupAr: "الإدارة" },
  "settings.manage": { nameAr: "إدارة إعدادات النظام", groupAr: "الإدارة" },
  "reference.manage": { nameAr: "إدارة القوائم المرجعية", groupAr: "الإدارة" },
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionCode[];

type RoleDef = { nameAr: string; description: string; permissions: PermissionCode[] };

const BASE: PermissionCode[] = ["dashboard.view", "violation.view", "legal_library.view"];

// الأدوار الأساسية. مدير النظام لا يملك أي صلاحية مصادقة رسمية.
export const SYSTEM_ROLES: Record<string, RoleDef> = {
  REGISTRAR: {
    nameAr: "موظف تسجيل المخالفة",
    description: "يسجل المخالفات ويرفع المحاضر ويحيلها للمصادقة",
    permissions: [...BASE, "violation.create", "violation.edit", "violation.submit", "attachment.upload", "closure.request"],
  },
  TECHNICAL: {
    nameAr: "القسم الفني",
    description: "يعد الموقف الفني ويتحقق من الاستجابات الفنية وإزالة المخالفة",
    permissions: [
      ...BASE, "attachment.upload", "technical.prepare", "technical.review",
      "response.record", "response.technical_verify", "removal.record", "deadline.view",
    ],
  },
  LEGAL: {
    nameAr: "الدائرة القانونية",
    description: "يعد الرأي القانوني ويصادق عليه ويدير الدعاوى والأحكام",
    permissions: [
      ...BASE, "attachment.upload", "attachment.view_confidential", "legal.prepare", "legal.approve",
      "warning.prepare", "template.manage", "deadline.view", "response.record", "response.legal_decide",
      "objection.record", "objection.decide", "extension.record", "nonresponse.initiate",
      "criminal.view", "criminal.manage", "judgment.record", "judgment.approve", "closure.request",
      "legal_library.manage", "reports.view",
    ],
  },
  CHAIRMAN: {
    nameAr: "رئيس الهيئة",
    description: "المصادقة النهائية والموافقة على إصدار الإنذار والقرارات العليا",
    permissions: [
      ...BASE, "scope.central", "attachment.view_confidential", "approval.final_registration",
      "warning.approve_issue", "extension.decide", "response.decide", "removal.approve",
      "nonresponse.approve", "closure.approve", "violation.reopen", "criminal.view",
      "financial.view", "deadline.view", "reports.view", "reports.performance", "audit.view",
    ],
  },
  SENIOR_MGMT: {
    nameAr: "الإدارة العليا",
    description: "اطلاع مركزي ومتابعة وتقارير",
    permissions: [
      ...BASE, "scope.central", "deadline.view", "criminal.view", "financial.view",
      "reports.view", "reports.performance", "audit.view",
    ],
  },
  FINANCE: {
    nameAr: "القسم المالي",
    description: "يسجل الاستجابات المالية والتسديدات",
    permissions: [...BASE, "attachment.upload", "financial.view", "financial.record", "response.record", "deadline.view", "reports.view"],
  },
  DELIVERY: {
    nameAr: "شعبة التبليغات",
    description: "تسجل إرسال الإنذارات ووصولات الاستلام",
    permissions: [...BASE, "attachment.upload", "warning.upload_signed", "delivery.record", "deadline.view"],
  },
  BRANCH_MANAGER: {
    nameAr: "مدير الفرع أو المكتب",
    description: "يتابع مخالفات فرعه ويعتمد بعض الإجراءات المحلية",
    permissions: [
      ...BASE, "violation.create", "violation.edit", "violation.submit", "attachment.upload",
      "deadline.view", "delivery.correct_receipt", "extension.record", "closure.request", "reports.view",
    ],
  },
  SYSADMIN: {
    nameAr: "مدير النظام",
    description: "إدارة الحسابات والإعدادات التقنية دون صلاحيات مصادقة رسمية",
    permissions: [
      "dashboard.view", "users.manage", "roles.manage", "settings.manage", "reference.manage",
      "deadline.rules_manage", "audit.view",
    ],
  },
};

/// صلاحيات لا يجوز منحها لدور مدير النظام حتى من واجهة إدارة الأدوار (فصل المهام)
export const SYSADMIN_FORBIDDEN: PermissionCode[] = [
  "approval.final_registration", "technical.review", "legal.approve", "warning.approve_issue",
  "extension.decide", "response.decide", "removal.approve", "nonresponse.approve",
  "judgment.approve", "closure.approve", "violation.reopen", "financial.approve_overpayment",
];
