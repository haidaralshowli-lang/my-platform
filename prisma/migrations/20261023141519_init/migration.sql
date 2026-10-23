-- CreateEnum
CREATE TYPE "GeneralStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ViolationStage" AS ENUM ('DRAFT', 'REGISTERED', 'AWAITING_REPORT', 'AWAITING_FINAL_APPROVAL', 'AWAITING_TECHNICAL', 'AWAITING_LEGAL', 'AWAITING_WARNING_APPROVAL', 'WARNING_PREPARATION', 'AWAITING_WARNING_SIGNATURE', 'AWAITING_DELIVERY', 'AWAITING_RECEIPT_PROOF', 'DEADLINE_RUNNING', 'AWAITING_RESPONSE_RECORD', 'AWAITING_RESPONSE_VERIFICATION', 'EXTENSION_UNDER_REVIEW', 'OBJECTION_UNDER_REVIEW', 'DEADLINE_EXPIRED', 'AWAITING_NON_RESPONSE_APPROVAL', 'CRIMINAL_CASE', 'AWAITING_JUDGMENT', 'AWAITING_FINAL_VERIFICATION', 'AWAITING_CLOSURE_APPROVAL', 'NOT_APPROVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ViolationOutcome" AS ENUM ('FINANCIAL_RESPONSE', 'TECHNICAL_RESPONSE', 'LEGAL_RESPONSE', 'FULL_REMOVAL', 'NON_RESPONSE_CRIMINAL', 'OBJECTION_APPEAL', 'NOT_APPROVED', 'OTHER');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "AccessScope" AS ENUM ('OFFICE', 'GOVERNORATE', 'CENTRAL');

-- CreateEnum
CREATE TYPE "Confidentiality" AS ENUM ('NORMAL', 'RESTRICTED', 'CONFIDENTIAL');

-- CreateEnum
CREATE TYPE "AttachmentApproval" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'NOT_SCANNED');

-- CreateEnum
CREATE TYPE "ApprovalKind" AS ENUM ('FINAL_REGISTRATION', 'TECHNICAL_REVIEW', 'LEGAL_APPROVAL', 'WARNING_ISSUE', 'RESPONSE_VERIFICATION', 'REMOVAL_ACCEPTANCE', 'NON_RESPONSE', 'JUDGMENT_APPROVAL', 'CLOSURE', 'REOPEN');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'RETURNED', 'REJECTED', 'CLARIFICATION_REQUESTED');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED');

-- CreateEnum
CREATE TYPE "WarningStatus" AS ENUM ('DRAFT', 'AWAITING_SIGNATURE', 'SIGNED', 'SENT', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('HAND', 'REGISTERED_MAIL', 'OFFICIAL_COURIER', 'EMAIL', 'OTHER');

-- CreateEnum
CREATE TYPE "DurationUnit" AS ENUM ('CALENDAR_DAYS', 'WORKING_DAYS');

-- CreateEnum
CREATE TYPE "DeadlineStartEvent" AS ENUM ('RECEIPT_DATE', 'DAY_AFTER_RECEIPT');

-- CreateEnum
CREATE TYPE "ObjectionEffect" AS ENUM ('NONE', 'SUSPEND', 'MANUAL_DECISION');

-- CreateEnum
CREATE TYPE "DeadlineStatus" AS ENUM ('NOT_STARTED', 'RUNNING', 'NEAR_EXPIRY', 'EXPIRED', 'EXTENDED', 'SUSPENDED', 'PENDING_REVIEW', 'STOPPED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ResponseKind" AS ENUM ('FINANCIAL', 'TECHNICAL', 'LEGAL');

-- CreateEnum
CREATE TYPE "ResponseStatus" AS ENUM ('RECORDED', 'UNDER_VERIFICATION', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ComplianceLevel" AS ENUM ('FULL', 'PARTIAL', 'NOT_VERIFIED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'UNDER_AUDIT');

-- CreateEnum
CREATE TYPE "ObjectionKind" AS ENUM ('OBJECTION', 'APPEAL');

-- CreateEnum
CREATE TYPE "CriminalCaseStatus" AS ENUM ('PREPARING', 'REFERRED', 'IN_COURT', 'JUDGMENT_ISSUED', 'CLOSED');

-- CreateEnum
CREATE TYPE "JudgmentProceduralStatus" AS ENUM ('UNKNOWN', 'NOT_FINAL', 'APPEALED', 'FINAL');

-- CreateEnum
CREATE TYPE "ClosurePath" AS ENUM ('RESPONSE', 'CRIMINAL_CASE', 'NOT_APPROVED', 'OTHER');

-- CreateEnum
CREATE TYPE "LegalDocType" AS ENUM ('LAW', 'REGULATION', 'INSTRUCTION', 'DECISION', 'CIRCULAR', 'TECHNICAL_STANDARD', 'OTHER');

-- CreateEnum
CREATE TYPE "LegalDocStatus" AS ENUM ('DRAFT', 'IN_FORCE', 'AMENDED', 'REPEALED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LegalRefPurpose" AS ENUM ('POTENTIAL', 'TECHNICAL', 'LEGAL', 'WARNING');

-- CreateTable
CREATE TABLE "Governorate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Governorate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Office" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "governorateId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Office_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Division" (
    "id" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "officeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Division_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViolationType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViolationType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetectionSource" (
    "id" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DetectionSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityType" (
    "id" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EntityType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityType" (
    "id" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ActivityType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JudgmentResultType" (
    "id" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "JudgmentResultType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "nameAr" TEXT NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "jobTitle" TEXT,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "scope" "AccessScope" NOT NULL DEFAULT 'OFFICE',
    "governorateId" TEXT,
    "officeId" TEXT,
    "divisionId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "groupAr" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Violation" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "draftRef" TEXT NOT NULL,
    "paperReportNumber" TEXT,
    "officialLetterNumber" TEXT,
    "discoveredAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3),
    "governorateId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "divisionId" TEXT,
    "violationTypeId" TEXT,
    "offenderName" TEXT NOT NULL,
    "entityTypeId" TEXT,
    "offenderLicenseNo" TEXT,
    "activityTypeId" TEXT,
    "offenderAddress" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "description" TEXT,
    "detectionSourceId" TEXT,
    "organizerName" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "internalNotes" TEXT,
    "generalStatus" "GeneralStatus" NOT NULL DEFAULT 'OPEN',
    "stage" "ViolationStage" NOT NULL DEFAULT 'DRAFT',
    "outcome" "ViolationOutcome",
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Violation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViolationStatusHistory" (
    "id" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "fromStage" "ViolationStage",
    "toStage" "ViolationStage" NOT NULL,
    "fromStatus" "GeneralStatus",
    "toStatus" "GeneralStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "actorId" TEXT NOT NULL,
    "actorRoles" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViolationStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStageConfig" (
    "stage" "ViolationStage" NOT NULL,
    "labelAr" TEXT NOT NULL,
    "slaDays" INTEGER,
    "sortOrder" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowStageConfig_pkey" PRIMARY KEY ("stage")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "kind" "ApprovalKind" NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "notes" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "decidedById" TEXT NOT NULL,
    "decidedRole" TEXT[],
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "violationId" TEXT,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "description" TEXT,
    "letterNumber" TEXT,
    "letterDate" DATE,
    "confidentiality" "Confidentiality" NOT NULL DEFAULT 'NORMAL',
    "approvalStatus" "AttachmentApproval" NOT NULL DEFAULT 'DRAFT',
    "currentVersionNo" INTEGER NOT NULL DEFAULT 1,
    "additionReason" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttachmentVersion" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'NOT_SCANNED',
    "reason" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttachmentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalDocument" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "docType" "LegalDocType" NOT NULL,
    "number" TEXT,
    "issuedAt" DATE,
    "issuer" TEXT,
    "effectiveAt" DATE,
    "status" "LegalDocStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "keywords" TEXT[],
    "previousDocumentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "notes" TEXT,
    "extractedText" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalArticle" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "articleNumber" TEXT NOT NULL,
    "paragraph" TEXT,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViolationLegalReference" (
    "id" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "purpose" "LegalRefPurpose" NOT NULL,
    "note" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViolationLegalReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicalAssessment" (
    "id" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "reasons" TEXT NOT NULL,
    "evidence" TEXT,
    "recommendation" TEXT,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicalAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalAssessment" (
    "id" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "opinion" TEXT NOT NULL,
    "reasons" TEXT NOT NULL,
    "proposedAction" TEXT,
    "notes" TEXT,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarningTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "currentVersionNo" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarningTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarningTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarningTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warning" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "renderedBody" TEXT NOT NULL,
    "requiredAction" TEXT NOT NULL,
    "responsePeriodText" TEXT,
    "status" "WarningStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedById" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedAt" TIMESTAMP(3),
    "signerName" TEXT,
    "signedAttachmentId" TEXT,
    "signedUploadedById" TEXT,
    "signedUploadedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRecord" (
    "id" TEXT NOT NULL,
    "warningId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "method" "DeliveryMethod" NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "recipientName" TEXT,
    "recipientCapacity" TEXT,
    "receiptNumber" TEXT,
    "receiptAttachmentId" TEXT,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptCorrection" (
    "id" TEXT NOT NULL,
    "deliveryRecordId" TEXT NOT NULL,
    "oldReceivedAt" TIMESTAMP(3),
    "newReceivedAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalDeadlineRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "violationTypeId" TEXT,
    "duration" INTEGER NOT NULL,
    "unit" "DurationUnit" NOT NULL,
    "startEvent" "DeadlineStartEvent" NOT NULL,
    "excludeHolidays" BOOLEAN NOT NULL DEFAULT false,
    "legalBasis" TEXT NOT NULL,
    "extensionAllowed" BOOLEAN NOT NULL DEFAULT false,
    "maxExtensionDays" INTEGER,
    "objectionEffect" "ObjectionEffect" NOT NULL DEFAULT 'MANUAL_DECISION',
    "warnBeforeDays" INTEGER NOT NULL DEFAULT 3,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalDeadlineRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeadlineCalculation" (
    "id" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "warningId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "startDate" TIMESTAMP(3),
    "originalDueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "status" "DeadlineStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "totalExtensionDays" INTEGER NOT NULL DEFAULT 0,
    "suspendedAt" TIMESTAMP(3),
    "suspensionReason" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeadlineCalculation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtensionRequest" (
    "id" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "deadlineId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "requestedDays" INTEGER NOT NULL,
    "reasons" TEXT NOT NULL,
    "opinion" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "grantedDays" INTEGER,
    "newDueDate" TIMESTAMP(3),
    "decisionNotes" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtensionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Response" (
    "id" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "kind" "ResponseKind" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "letterNumber" TEXT,
    "letterDate" DATE,
    "summary" TEXT NOT NULL,
    "status" "ResponseStatus" NOT NULL DEFAULT 'RECORDED',
    "decisionNotes" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialResponse" (
    "responseId" TEXT NOT NULL,
    "financialType" TEXT NOT NULL,
    "transactionNumber" TEXT,
    "amountDue" DECIMAL(18,2),
    "amountDueBasis" TEXT,
    "auditResult" TEXT,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "officerName" TEXT,

    CONSTRAINT "FinancialResponse_pkey" PRIMARY KEY ("responseId")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "financialResponseId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paidAt" DATE NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "overpaymentReason" TEXT,
    "overpaymentApprover" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicalResponse" (
    "responseId" TEXT NOT NULL,
    "correctiveAction" TEXT NOT NULL,
    "implementedAt" DATE,
    "inspectionReport" TEXT,
    "verificationResult" TEXT,
    "compliance" "ComplianceLevel" NOT NULL DEFAULT 'NOT_VERIFIED',
    "recommendation" TEXT,

    CONSTRAINT "TechnicalResponse_pkey" PRIMARY KEY ("responseId")
);

-- CreateTable
CREATE TABLE "LegalResponse" (
    "responseId" TEXT NOT NULL,
    "legalType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "legalOpinion" TEXT,
    "proposedAction" TEXT,

    CONSTRAINT "LegalResponse_pkey" PRIMARY KEY ("responseId")
);

-- CreateTable
CREATE TABLE "RemovalRecord" (
    "id" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "treatedAt" DATE NOT NULL,
    "verificationReport" TEXT,
    "inspectionResult" TEXT,
    "verifiedByName" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "decisionNotes" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemovalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Objection" (
    "id" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "kind" "ObjectionKind" NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "referenceNumber" TEXT,
    "content" TEXT NOT NULL,
    "competentAuthority" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "outcome" TEXT,
    "effectOnFlow" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Objection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectionEvent" (
    "id" TEXT NOT NULL,
    "objectionId" TEXT NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObjectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriminalCase" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "warningId" TEXT,
    "nonResponseProof" TEXT NOT NULL,
    "referralAt" DATE,
    "courtCaseNumber" TEXT,
    "courtName" TEXT,
    "courtRegisteredAt" DATE,
    "lastAction" TEXT,
    "status" "CriminalCaseStatus" NOT NULL DEFAULT 'PREPARING',
    "followUpOwnerId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CriminalCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriminalCaseEvent" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "nextHearingAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CriminalCaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourtJudgment" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "judgmentDate" DATE NOT NULL,
    "courtName" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "resultTypeId" TEXT,
    "copyReceivedAt" DATE,
    "proceduralStatus" "JudgmentProceduralStatus" NOT NULL DEFAULT 'UNKNOWN',
    "appealNote" TEXT,
    "legalNotes" TEXT,
    "attachmentId" TEXT,
    "enteredById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourtJudgment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClosureRequest" (
    "id" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "path" "ClosurePath" NOT NULL,
    "finalOutcome" "ViolationOutcome" NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "supportingAttachmentIds" TEXT[],
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNotes" TEXT,

    CONSTRAINT "ClosureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReopenRecord" (
    "id" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "closureRequestId" TEXT,
    "reason" TEXT NOT NULL,
    "reopenedById" TEXT NOT NULL,
    "reopenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredStage" "ViolationStage" NOT NULL,

    CONSTRAINT "ReopenRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "violationId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "username" TEXT,
    "roles" TEXT[],
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "requestId" TEXT,
    "ip" TEXT,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "NumberingSequence" (
    "key" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberingSequence_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Governorate_code_key" ON "Governorate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Governorate_nameAr_key" ON "Governorate"("nameAr");

-- CreateIndex
CREATE UNIQUE INDEX "Office_code_key" ON "Office"("code");

-- CreateIndex
CREATE INDEX "Office_governorateId_idx" ON "Office"("governorateId");

-- CreateIndex
CREATE UNIQUE INDEX "Office_governorateId_nameAr_key" ON "Office"("governorateId", "nameAr");

-- CreateIndex
CREATE UNIQUE INDEX "Division_officeId_nameAr_key" ON "Division"("officeId", "nameAr");

-- CreateIndex
CREATE UNIQUE INDEX "ViolationType_code_key" ON "ViolationType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ViolationType_nameAr_key" ON "ViolationType"("nameAr");

-- CreateIndex
CREATE UNIQUE INDEX "DetectionSource_nameAr_key" ON "DetectionSource"("nameAr");

-- CreateIndex
CREATE UNIQUE INDEX "EntityType_nameAr_key" ON "EntityType"("nameAr");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityType_nameAr_key" ON "ActivityType"("nameAr");

-- CreateIndex
CREATE UNIQUE INDEX "JudgmentResultType_nameAr_key" ON "JudgmentResultType"("nameAr");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_governorateId_idx" ON "User"("governorateId");

-- CreateIndex
CREATE INDEX "User_officeId_idx" ON "User"("officeId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_username_createdAt_idx" ON "LoginAttempt"("username", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Violation_number_key" ON "Violation"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Violation_draftRef_key" ON "Violation"("draftRef");

-- CreateIndex
CREATE INDEX "Violation_governorateId_officeId_idx" ON "Violation"("governorateId", "officeId");

-- CreateIndex
CREATE INDEX "Violation_stage_idx" ON "Violation"("stage");

-- CreateIndex
CREATE INDEX "Violation_generalStatus_idx" ON "Violation"("generalStatus");

-- CreateIndex
CREATE INDEX "Violation_violationTypeId_idx" ON "Violation"("violationTypeId");

-- CreateIndex
CREATE INDEX "Violation_offenderName_idx" ON "Violation"("offenderName");

-- CreateIndex
CREATE INDEX "Violation_offenderLicenseNo_idx" ON "Violation"("offenderLicenseNo");

-- CreateIndex
CREATE INDEX "Violation_paperReportNumber_idx" ON "Violation"("paperReportNumber");

-- CreateIndex
CREATE INDEX "Violation_officialLetterNumber_idx" ON "Violation"("officialLetterNumber");

-- CreateIndex
CREATE INDEX "Violation_registeredAt_idx" ON "Violation"("registeredAt");

-- CreateIndex
CREATE INDEX "Violation_isDemo_idx" ON "Violation"("isDemo");

-- CreateIndex
CREATE INDEX "ViolationStatusHistory_violationId_createdAt_idx" ON "ViolationStatusHistory"("violationId", "createdAt");

-- CreateIndex
CREATE INDEX "Approval_violationId_kind_idx" ON "Approval"("violationId", "kind");

-- CreateIndex
CREATE INDEX "Attachment_violationId_idx" ON "Attachment"("violationId");

-- CreateIndex
CREATE INDEX "Attachment_ownerType_ownerId_idx" ON "Attachment"("ownerType", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "AttachmentVersion_storageKey_key" ON "AttachmentVersion"("storageKey");

-- CreateIndex
CREATE INDEX "AttachmentVersion_sha256_idx" ON "AttachmentVersion"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "AttachmentVersion_attachmentId_versionNo_key" ON "AttachmentVersion"("attachmentId", "versionNo");

-- CreateIndex
CREATE INDEX "LegalDocument_title_idx" ON "LegalDocument"("title");

-- CreateIndex
CREATE INDEX "LegalDocument_number_idx" ON "LegalDocument"("number");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocumentVersion_documentId_versionNo_key" ON "LegalDocumentVersion"("documentId", "versionNo");

-- CreateIndex
CREATE INDEX "LegalArticle_documentVersionId_idx" ON "LegalArticle"("documentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ViolationLegalReference_violationId_articleId_purpose_key" ON "ViolationLegalReference"("violationId", "articleId", "purpose");

-- CreateIndex
CREATE INDEX "TechnicalAssessment_violationId_idx" ON "TechnicalAssessment"("violationId");

-- CreateIndex
CREATE INDEX "LegalAssessment_violationId_idx" ON "LegalAssessment"("violationId");

-- CreateIndex
CREATE UNIQUE INDEX "WarningTemplate_name_key" ON "WarningTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "WarningTemplateVersion_templateId_versionNo_key" ON "WarningTemplateVersion"("templateId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "Warning_number_key" ON "Warning"("number");

-- CreateIndex
CREATE INDEX "Warning_violationId_idx" ON "Warning"("violationId");

-- CreateIndex
CREATE INDEX "DeliveryRecord_warningId_idx" ON "DeliveryRecord"("warningId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDeadlineRule_code_key" ON "LegalDeadlineRule"("code");

-- CreateIndex
CREATE INDEX "LegalDeadlineRule_violationTypeId_isActive_idx" ON "LegalDeadlineRule"("violationTypeId", "isActive");

-- CreateIndex
CREATE INDEX "DeadlineCalculation_status_dueDate_idx" ON "DeadlineCalculation"("status", "dueDate");

-- CreateIndex
CREATE INDEX "DeadlineCalculation_violationId_isCurrent_idx" ON "DeadlineCalculation"("violationId", "isCurrent");

-- CreateIndex
CREATE INDEX "ExtensionRequest_violationId_idx" ON "ExtensionRequest"("violationId");

-- CreateIndex
CREATE INDEX "ExtensionRequest_status_idx" ON "ExtensionRequest"("status");

-- CreateIndex
CREATE INDEX "Response_violationId_kind_idx" ON "Response"("violationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_financialResponseId_receiptNumber_key" ON "Payment"("financialResponseId", "receiptNumber");

-- CreateIndex
CREATE INDEX "RemovalRecord_violationId_idx" ON "RemovalRecord"("violationId");

-- CreateIndex
CREATE INDEX "Objection_violationId_idx" ON "Objection"("violationId");

-- CreateIndex
CREATE UNIQUE INDEX "CriminalCase_number_key" ON "CriminalCase"("number");

-- CreateIndex
CREATE UNIQUE INDEX "CriminalCase_violationId_key" ON "CriminalCase"("violationId");

-- CreateIndex
CREATE INDEX "CriminalCase_status_idx" ON "CriminalCase"("status");

-- CreateIndex
CREATE INDEX "CriminalCase_courtCaseNumber_idx" ON "CriminalCase"("courtCaseNumber");

-- CreateIndex
CREATE INDEX "CriminalCaseEvent_caseId_eventAt_idx" ON "CriminalCaseEvent"("caseId", "eventAt");

-- CreateIndex
CREATE INDEX "CourtJudgment_number_idx" ON "CourtJudgment"("number");

-- CreateIndex
CREATE INDEX "ClosureRequest_violationId_idx" ON "ClosureRequest"("violationId");

-- CreateIndex
CREATE INDEX "ClosureRequest_status_idx" ON "ClosureRequest"("status");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_at_idx" ON "AuditLog"("userId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_action_at_idx" ON "AuditLog"("action", "at");

-- AddForeignKey
ALTER TABLE "Office" ADD CONSTRAINT "Office_governorateId_fkey" FOREIGN KEY ("governorateId") REFERENCES "Governorate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Division" ADD CONSTRAINT "Division_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_governorateId_fkey" FOREIGN KEY ("governorateId") REFERENCES "Governorate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_governorateId_fkey" FOREIGN KEY ("governorateId") REFERENCES "Governorate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_violationTypeId_fkey" FOREIGN KEY ("violationTypeId") REFERENCES "ViolationType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_entityTypeId_fkey" FOREIGN KEY ("entityTypeId") REFERENCES "EntityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_detectionSourceId_fkey" FOREIGN KEY ("detectionSourceId") REFERENCES "DetectionSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViolationStatusHistory" ADD CONSTRAINT "ViolationStatusHistory_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttachmentVersion" ADD CONSTRAINT "AttachmentVersion_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_previousDocumentId_fkey" FOREIGN KEY ("previousDocumentId") REFERENCES "LegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalDocumentVersion" ADD CONSTRAINT "LegalDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "LegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalArticle" ADD CONSTRAINT "LegalArticle_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "LegalDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViolationLegalReference" ADD CONSTRAINT "ViolationLegalReference_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViolationLegalReference" ADD CONSTRAINT "ViolationLegalReference_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "LegalArticle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalAssessment" ADD CONSTRAINT "TechnicalAssessment_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalAssessment" ADD CONSTRAINT "LegalAssessment_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarningTemplateVersion" ADD CONSTRAINT "WarningTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WarningTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warning" ADD CONSTRAINT "Warning_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warning" ADD CONSTRAINT "Warning_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "WarningTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_warningId_fkey" FOREIGN KEY ("warningId") REFERENCES "Warning"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptCorrection" ADD CONSTRAINT "ReceiptCorrection_deliveryRecordId_fkey" FOREIGN KEY ("deliveryRecordId") REFERENCES "DeliveryRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalDeadlineRule" ADD CONSTRAINT "LegalDeadlineRule_violationTypeId_fkey" FOREIGN KEY ("violationTypeId") REFERENCES "ViolationType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadlineCalculation" ADD CONSTRAINT "DeadlineCalculation_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadlineCalculation" ADD CONSTRAINT "DeadlineCalculation_warningId_fkey" FOREIGN KEY ("warningId") REFERENCES "Warning"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadlineCalculation" ADD CONSTRAINT "DeadlineCalculation_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "LegalDeadlineRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtensionRequest" ADD CONSTRAINT "ExtensionRequest_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtensionRequest" ADD CONSTRAINT "ExtensionRequest_deadlineId_fkey" FOREIGN KEY ("deadlineId") REFERENCES "DeadlineCalculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Response" ADD CONSTRAINT "Response_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialResponse" ADD CONSTRAINT "FinancialResponse_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "Response"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_financialResponseId_fkey" FOREIGN KEY ("financialResponseId") REFERENCES "FinancialResponse"("responseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalResponse" ADD CONSTRAINT "TechnicalResponse_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "Response"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalResponse" ADD CONSTRAINT "LegalResponse_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "Response"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemovalRecord" ADD CONSTRAINT "RemovalRecord_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Objection" ADD CONSTRAINT "Objection_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectionEvent" ADD CONSTRAINT "ObjectionEvent_objectionId_fkey" FOREIGN KEY ("objectionId") REFERENCES "Objection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriminalCase" ADD CONSTRAINT "CriminalCase_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriminalCase" ADD CONSTRAINT "CriminalCase_followUpOwnerId_fkey" FOREIGN KEY ("followUpOwnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriminalCaseEvent" ADD CONSTRAINT "CriminalCaseEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CriminalCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtJudgment" ADD CONSTRAINT "CourtJudgment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CriminalCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtJudgment" ADD CONSTRAINT "CourtJudgment_resultTypeId_fkey" FOREIGN KEY ("resultTypeId") REFERENCES "JudgmentResultType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosureRequest" ADD CONSTRAINT "ClosureRequest_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReopenRecord" ADD CONSTRAINT "ReopenRecord_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
