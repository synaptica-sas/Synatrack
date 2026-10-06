


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."AlertSeverity" AS ENUM (
    'INFO',
    'WARNING',
    'CRITICAL'
);


ALTER TYPE "public"."AlertSeverity" OWNER TO "postgres";


CREATE TYPE "public"."AlertType" AS ENUM (
    'BUDGET_WARNING',
    'BUDGET_EXCEEDED',
    'MARGIN_BELOW_THRESHOLD',
    'ASSIGNMENT_ENDING',
    'CONSULTANT_OVERLOADED',
    'FORECAST_DEVIATION',
    'FX_RATE_MISSING'
);


ALTER TYPE "public"."AlertType" OWNER TO "postgres";


CREATE TYPE "public"."AllocationMode" AS ENUM (
    'PERCENTAGE',
    'HOURS'
);


ALTER TYPE "public"."AllocationMode" OWNER TO "postgres";


CREATE TYPE "public"."AppRole" AS ENUM (
    'ADMIN',
    'PM',
    'CONSULTANT',
    'FINANCE',
    'VIEWER'
);


ALTER TYPE "public"."AppRole" OWNER TO "postgres";


CREATE TYPE "public"."AssignmentStatus" AS ENUM (
    'PLANNED',
    'ACTIVE',
    'PARTIAL',
    'COMPLETED',
    'CANCELLED'
);


ALTER TYPE "public"."AssignmentStatus" OWNER TO "postgres";


CREATE TYPE "public"."BlockType" AS ENUM (
    'VACATION',
    'SICK_LEAVE',
    'NATIONAL_HOLIDAY',
    'INTERNAL_BENCH',
    'TRAINING',
    'OTHER'
);


ALTER TYPE "public"."BlockType" OWNER TO "postgres";


CREATE TYPE "public"."ChangeRequestStatus" AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'WITHDRAWN'
);


ALTER TYPE "public"."ChangeRequestStatus" OWNER TO "postgres";


CREATE TYPE "public"."ChangeRequestType" AS ENUM (
    'SCOPE',
    'BUDGET',
    'SCHEDULE',
    'RESOURCE',
    'OTHER'
);


ALTER TYPE "public"."ChangeRequestType" OWNER TO "postgres";


CREATE TYPE "public"."ExtraHourStatus" AS ENUM (
    'PENDING_PM',
    'PENDING_FINANCE',
    'APPROVED',
    'REJECTED'
);


ALTER TYPE "public"."ExtraHourStatus" OWNER TO "postgres";


CREATE TYPE "public"."FxRateType" AS ENUM (
    'SPOT',
    'AVERAGE',
    'BUDGET'
);


ALTER TYPE "public"."FxRateType" OWNER TO "postgres";


CREATE TYPE "public"."HealthStatus" AS ENUM (
    'GREEN',
    'YELLOW',
    'RED'
);


ALTER TYPE "public"."HealthStatus" OWNER TO "postgres";


CREATE TYPE "public"."IssueSeverity" AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
);


ALTER TYPE "public"."IssueSeverity" OWNER TO "postgres";


CREATE TYPE "public"."IssueStatus" AS ENUM (
    'OPEN',
    'IN_PROGRESS',
    'RESOLVED',
    'CLOSED'
);


ALTER TYPE "public"."IssueStatus" OWNER TO "postgres";


CREATE TYPE "public"."MilestoneStatus" AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
    'DELAYED',
    'CANCELLED'
);


ALTER TYPE "public"."MilestoneStatus" OWNER TO "postgres";


CREATE TYPE "public"."ProjectPhase" AS ENUM (
    'INITIATION',
    'PLANNING',
    'EXECUTION',
    'MONITORING',
    'CLOSING'
);


ALTER TYPE "public"."ProjectPhase" OWNER TO "postgres";


CREATE TYPE "public"."ProjectStatus" AS ENUM (
    'ACTIVE',
    'PAUSED',
    'CLOSED'
);


ALTER TYPE "public"."ProjectStatus" OWNER TO "postgres";


CREATE TYPE "public"."ProjectType" AS ENUM (
    'FIXED_PRICE',
    'TIME_AND_MATERIAL',
    'STAFFING'
);


ALTER TYPE "public"."ProjectType" OWNER TO "postgres";


CREATE TYPE "public"."RiskStatus" AS ENUM (
    'OPEN',
    'MITIGATED',
    'ACCEPTED',
    'CLOSED'
);


ALTER TYPE "public"."RiskStatus" OWNER TO "postgres";


CREATE TYPE "public"."TimeEntryStatus" AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED'
);


ALTER TYPE "public"."TimeEntryStatus" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."Activity" (
    "id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "consultantId" "text" NOT NULL,
    "projectId" "text",
    "activityType" "text" DEFAULT 'project'::"text" NOT NULL,
    "scheduledDate" timestamp(3) without time zone NOT NULL,
    "dueDate" timestamp(3) without time zone,
    "completedDate" timestamp(3) without time zone,
    "estimatedHours" numeric(5,2) NOT NULL,
    "actualHours" numeric(5,2) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "comments" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."Activity" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Alert" (
    "id" "text" NOT NULL,
    "type" "public"."AlertType" NOT NULL,
    "severity" "public"."AlertSeverity" DEFAULT 'WARNING'::"public"."AlertSeverity" NOT NULL,
    "projectId" "text",
    "consultantId" "text",
    "message" "text" NOT NULL,
    "metadata" "jsonb",
    "resolvedAt" timestamp(3) without time zone,
    "resolvedBy" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."Alert" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ApprovalDelegation" (
    "id" "text" NOT NULL,
    "projectId" "text" NOT NULL,
    "fromUserEmail" "text" NOT NULL,
    "toUserEmail" "text" NOT NULL,
    "startDate" timestamp(3) without time zone NOT NULL,
    "endDate" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."ApprovalDelegation" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Assignment" (
    "id" "text" NOT NULL,
    "projectId" "text" NOT NULL,
    "consultantId" "text" NOT NULL,
    "startDate" timestamp(3) without time zone NOT NULL,
    "endDate" timestamp(3) without time zone NOT NULL,
    "allocationMode" "public"."AllocationMode" DEFAULT 'PERCENTAGE'::"public"."AllocationMode" NOT NULL,
    "allocationPct" numeric(5,2),
    "hoursPerPeriod" numeric(8,2),
    "periodUnit" "text",
    "status" "public"."AssignmentStatus" DEFAULT 'PLANNED'::"public"."AssignmentStatus" NOT NULL,
    "role" "text",
    "note" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."Assignment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."AuditLog" (
    "id" "text" NOT NULL,
    "entity" "text" NOT NULL,
    "entityId" "text" NOT NULL,
    "action" "text" NOT NULL,
    "changedBy" "text" NOT NULL,
    "before" "jsonb",
    "after" "jsonb",
    "diff" "jsonb",
    "ipAddress" "text",
    "userAgent" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."AuditLog" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."CapacityConfig" (
    "id" "text" NOT NULL,
    "consultantId" "text",
    "country" "text",
    "hoursPerDay" numeric(4,2) DEFAULT 8 NOT NULL,
    "workDaysPerWeek" integer DEFAULT 5 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."CapacityConfig" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ChangeRequest" (
    "id" "text" NOT NULL,
    "projectId" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "type" "public"."ChangeRequestType" NOT NULL,
    "impactScope" "text",
    "impactBudget" numeric(14,2),
    "impactDays" integer,
    "requestedBy" "text" NOT NULL,
    "reviewedBy" "text",
    "status" "public"."ChangeRequestStatus" DEFAULT 'PENDING'::"public"."ChangeRequestStatus" NOT NULL,
    "resolvedAt" timestamp(3) without time zone,
    "resolution" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."ChangeRequest" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Consultant" (
    "id" "text" NOT NULL,
    "fullName" "text" NOT NULL,
    "email" "text",
    "role" "text" NOT NULL,
    "hourlyRate" numeric(14,2),
    "rateCurrency" "text" DEFAULT 'USD'::"text" NOT NULL,
    "country" "text",
    "costPerMonth" numeric(14,2),
    "skills" "text"[] DEFAULT ARRAY[]::"text"[],
    "seniority" "text",
    "maxHoursPerDay" numeric(4,2),
    "active" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "identification" "text",
    "allowWeekendWork" boolean DEFAULT false NOT NULL,
    "isInternal" boolean DEFAULT true NOT NULL,
    "company" "text"
);


ALTER TABLE "public"."Consultant" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ConsultantBlock" (
    "id" "text" NOT NULL,
    "consultantId" "text" NOT NULL,
    "startDate" timestamp(3) without time zone NOT NULL,
    "endDate" timestamp(3) without time zone NOT NULL,
    "blockType" "public"."BlockType" DEFAULT 'OTHER'::"public"."BlockType" NOT NULL,
    "note" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."ConsultantBlock" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."CustomHoliday" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "date" timestamp(3) without time zone NOT NULL,
    "country" "text" DEFAULT 'All'::"text" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."CustomHoliday" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Estimation" (
    "id" "text" NOT NULL,
    "projectId" "text",
    "projectName" "text" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "totalIdealHours" numeric(10,2) NOT NULL,
    "totalAdjustedHours" numeric(10,2) NOT NULL,
    "bufferPercentage" numeric(5,2) NOT NULL,
    "riskLevel" "text" NOT NULL,
    "confidenceLevel" numeric(5,2) NOT NULL,
    "rawDataJson" "text" NOT NULL
);


ALTER TABLE "public"."Estimation" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Expense" (
    "id" "text" NOT NULL,
    "projectId" "text" NOT NULL,
    "expenseDate" timestamp(3) without time zone NOT NULL,
    "category" "text" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "currency" "text" NOT NULL,
    "description" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."Expense" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ExtraHourEntry" (
    "id" "text" NOT NULL,
    "consultantId" "text" NOT NULL,
    "projectId" "text",
    "date" timestamp(3) without time zone NOT NULL,
    "startTime" "text" NOT NULL,
    "endTime" "text" NOT NULL,
    "diurnal" numeric(6,2) NOT NULL,
    "nocturnal" numeric(6,2) NOT NULL,
    "diurnalHoliday" numeric(6,2) NOT NULL,
    "nocturnalHoliday" numeric(6,2) NOT NULL,
    "totalHours" numeric(6,2) NOT NULL,
    "diurnalAmount" numeric(14,2) NOT NULL,
    "nocturnalAmount" numeric(14,2) NOT NULL,
    "diurnalHolidayAmount" numeric(14,2) NOT NULL,
    "nocturnalHolidayAmount" numeric(14,2) NOT NULL,
    "totalAmount" numeric(14,2) NOT NULL,
    "observations" "text",
    "status" "public"."ExtraHourStatus" DEFAULT 'PENDING_PM'::"public"."ExtraHourStatus" NOT NULL,
    "approvedBy" "text",
    "approvedAt" timestamp(3) without time zone,
    "rejectionNote" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."ExtraHourEntry" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ExtraHoursConfig" (
    "id" "text" NOT NULL,
    "weeklyExtraHoursLimit" numeric(5,2) DEFAULT 12 NOT NULL,
    "diurnalMultiplier" numeric(4,2) DEFAULT 1.25 NOT NULL,
    "nocturnalMultiplier" numeric(4,2) DEFAULT 1.75 NOT NULL,
    "diurnalHolidayMultiplier" numeric(4,2) DEFAULT 2.00 NOT NULL,
    "nocturnalHolidayMultiplier" numeric(4,2) DEFAULT 2.50 NOT NULL,
    "diurnalStart" "text" DEFAULT '06:00:00'::"text" NOT NULL,
    "diurnalEnd" "text" DEFAULT '21:00:00'::"text" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "country" "text" DEFAULT 'Default'::"text" NOT NULL,
    "monthlyDivisor" numeric(5,2) DEFAULT 220 NOT NULL
);


ALTER TABLE "public"."ExtraHoursConfig" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Forecast" (
    "id" "text" NOT NULL,
    "projectId" "text" NOT NULL,
    "consultantId" "text" NOT NULL,
    "startDate" "text" DEFAULT ''::"text" NOT NULL,
    "endDate" "text" DEFAULT ''::"text" NOT NULL,
    "hoursProjected" numeric(10,2) NOT NULL,
    "hourlyRate" numeric(14,2),
    "sellRate" numeric(14,2),
    "currency" "text" DEFAULT 'USD'::"text" NOT NULL,
    "note" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."Forecast" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."FxConfig" (
    "id" "text" NOT NULL,
    "baseCode" "text" NOT NULL,
    "quoteCode" "text" NOT NULL,
    "rate" numeric(18,6) NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."FxConfig" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."FxRateHistory" (
    "id" "text" NOT NULL,
    "baseCode" "text" NOT NULL,
    "quoteCode" "text" NOT NULL,
    "rate" numeric(18,6) NOT NULL,
    "effectiveDate" timestamp(3) without time zone NOT NULL,
    "rateType" "public"."FxRateType" DEFAULT 'SPOT'::"public"."FxRateType" NOT NULL,
    "source" "text",
    "createdBy" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."FxRateHistory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Issue" (
    "id" "text" NOT NULL,
    "projectId" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "severity" "public"."IssueSeverity" DEFAULT 'MEDIUM'::"public"."IssueSeverity" NOT NULL,
    "owner" "text",
    "status" "public"."IssueStatus" DEFAULT 'OPEN'::"public"."IssueStatus" NOT NULL,
    "resolvedAt" timestamp(3) without time zone,
    "resolution" "text",
    "createdBy" "text" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."Issue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Milestone" (
    "id" "text" NOT NULL,
    "projectId" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "plannedDate" timestamp(3) without time zone NOT NULL,
    "actualDate" timestamp(3) without time zone,
    "weight" numeric(5,2) DEFAULT 0 NOT NULL,
    "status" "public"."MilestoneStatus" DEFAULT 'PENDING'::"public"."MilestoneStatus" NOT NULL,
    "deliverable" "text",
    "acceptedBy" "text",
    "note" "text",
    "createdBy" "text" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."Milestone" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."MonthlySnapshot" (
    "id" "text" NOT NULL,
    "projectId" "text" NOT NULL,
    "year" integer NOT NULL,
    "month" integer NOT NULL,
    "baseCurrency" "text" NOT NULL,
    "laborCostActual" numeric(18,4) NOT NULL,
    "expensesActual" numeric(18,4) NOT NULL,
    "totalCostActual" numeric(18,4) NOT NULL,
    "revenueRecognized" numeric(18,4) NOT NULL,
    "contractValue" numeric(18,4) NOT NULL,
    "grossMargin" numeric(18,4) NOT NULL,
    "grossMarginPct" numeric(8,4) NOT NULL,
    "hoursApproved" numeric(10,2) NOT NULL,
    "fxSnapshotJson" "jsonb" NOT NULL,
    "closedBy" "text" NOT NULL,
    "closedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."MonthlySnapshot" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Project" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "company" "text" NOT NULL,
    "country" "text" NOT NULL,
    "currency" "text" NOT NULL,
    "budget" numeric(14,2) NOT NULL,
    "startDate" timestamp(3) without time zone NOT NULL,
    "endDate" timestamp(3) without time zone NOT NULL,
    "description" "text",
    "projectType" "public"."ProjectType" DEFAULT 'TIME_AND_MATERIAL'::"public"."ProjectType" NOT NULL,
    "status" "public"."ProjectStatus" DEFAULT 'ACTIVE'::"public"."ProjectStatus" NOT NULL,
    "sellPrice" numeric(14,2),
    "sellCurrency" "text" DEFAULT 'USD'::"text" NOT NULL,
    "marginThreshold" numeric(5,2),
    "budgetAlertPct" numeric(5,2) DEFAULT 90 NOT NULL,
    "healthStatus" "public"."HealthStatus" DEFAULT 'GREEN'::"public"."HealthStatus" NOT NULL,
    "completionPct" numeric(5,2),
    "phase" "public"."ProjectPhase" DEFAULT 'EXECUTION'::"public"."ProjectPhase" NOT NULL,
    "projectManagerEmail" "text",
    "baselineBudget" numeric(14,2),
    "baselineStartDate" timestamp(3) without time zone,
    "baselineEndDate" timestamp(3) without time zone,
    "baselineSetAt" timestamp(3) without time zone,
    "baselineSetBy" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "allowExtraHours" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."Project" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."RevenueEntry" (
    "id" "text" NOT NULL,
    "projectId" "text" NOT NULL,
    "entryDate" timestamp(3) without time zone NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "currency" "text" NOT NULL,
    "description" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."RevenueEntry" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Risk" (
    "id" "text" NOT NULL,
    "projectId" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "probability" integer NOT NULL,
    "impact" integer NOT NULL,
    "riskScore" integer NOT NULL,
    "category" "text",
    "owner" "text",
    "mitigationPlan" "text",
    "contingencyPlan" "text",
    "status" "public"."RiskStatus" DEFAULT 'OPEN'::"public"."RiskStatus" NOT NULL,
    "identifiedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "resolvedAt" timestamp(3) without time zone,
    "createdBy" "text" NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."Risk" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Role" (
    "id" "text" NOT NULL,
    "name" "public"."AppRole" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."Role" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."TimeEntry" (
    "id" "text" NOT NULL,
    "projectId" "text" NOT NULL,
    "consultantId" "text" NOT NULL,
    "workDate" timestamp(3) without time zone NOT NULL,
    "hours" numeric(8,2) NOT NULL,
    "note" "text",
    "status" "public"."TimeEntryStatus" DEFAULT 'PENDING'::"public"."TimeEntryStatus" NOT NULL,
    "approvedBy" "text",
    "approvedAt" timestamp(3) without time zone,
    "rejectionNote" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."TimeEntry" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."User" (
    "id" "text" NOT NULL,
    "email" "text" NOT NULL,
    "displayName" "text" NOT NULL,
    "microsoftOid" "text",
    "active" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "bio" "text",
    "photoUrl" "text",
    "phrase" "text",
    "skills" "text"[] DEFAULT ARRAY[]::"text"[],
    "country" "text"
);


ALTER TABLE "public"."User" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."UserRole" (
    "userId" "text" NOT NULL,
    "roleId" "text" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."UserRole" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_prisma_migrations" (
    "id" character varying(36) NOT NULL,
    "checksum" character varying(64) NOT NULL,
    "finished_at" timestamp with time zone,
    "migration_name" character varying(255) NOT NULL,
    "logs" "text",
    "rolled_back_at" timestamp with time zone,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "applied_steps_count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."_prisma_migrations" OWNER TO "postgres";


ALTER TABLE ONLY "public"."Activity"
    ADD CONSTRAINT "Activity_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Alert"
    ADD CONSTRAINT "Alert_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ApprovalDelegation"
    ADD CONSTRAINT "ApprovalDelegation_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Assignment"
    ADD CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."AuditLog"
    ADD CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."CapacityConfig"
    ADD CONSTRAINT "CapacityConfig_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ChangeRequest"
    ADD CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ConsultantBlock"
    ADD CONSTRAINT "ConsultantBlock_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Consultant"
    ADD CONSTRAINT "Consultant_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."CustomHoliday"
    ADD CONSTRAINT "CustomHoliday_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Estimation"
    ADD CONSTRAINT "Estimation_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Expense"
    ADD CONSTRAINT "Expense_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ExtraHourEntry"
    ADD CONSTRAINT "ExtraHourEntry_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ExtraHoursConfig"
    ADD CONSTRAINT "ExtraHoursConfig_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Forecast"
    ADD CONSTRAINT "Forecast_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."FxConfig"
    ADD CONSTRAINT "FxConfig_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."FxRateHistory"
    ADD CONSTRAINT "FxRateHistory_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Issue"
    ADD CONSTRAINT "Issue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Milestone"
    ADD CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."MonthlySnapshot"
    ADD CONSTRAINT "MonthlySnapshot_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Project"
    ADD CONSTRAINT "Project_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."RevenueEntry"
    ADD CONSTRAINT "RevenueEntry_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Risk"
    ADD CONSTRAINT "Risk_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Role"
    ADD CONSTRAINT "Role_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."TimeEntry"
    ADD CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."UserRole"
    ADD CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId", "roleId");



ALTER TABLE ONLY "public"."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."_prisma_migrations"
    ADD CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id");



CREATE INDEX "Activity_consultantId_idx" ON "public"."Activity" USING "btree" ("consultantId");



CREATE INDEX "Activity_projectId_idx" ON "public"."Activity" USING "btree" ("projectId");



CREATE INDEX "Activity_scheduledDate_idx" ON "public"."Activity" USING "btree" ("scheduledDate");



CREATE INDEX "Alert_consultantId_idx" ON "public"."Alert" USING "btree" ("consultantId");



CREATE INDEX "Alert_projectId_idx" ON "public"."Alert" USING "btree" ("projectId");



CREATE INDEX "Alert_type_resolvedAt_idx" ON "public"."Alert" USING "btree" ("type", "resolvedAt");



CREATE INDEX "ApprovalDelegation_fromUserEmail_idx" ON "public"."ApprovalDelegation" USING "btree" ("fromUserEmail");



CREATE INDEX "ApprovalDelegation_projectId_idx" ON "public"."ApprovalDelegation" USING "btree" ("projectId");



CREATE INDEX "ApprovalDelegation_toUserEmail_idx" ON "public"."ApprovalDelegation" USING "btree" ("toUserEmail");



CREATE INDEX "Assignment_consultantId_idx" ON "public"."Assignment" USING "btree" ("consultantId");



CREATE INDEX "Assignment_projectId_idx" ON "public"."Assignment" USING "btree" ("projectId");



CREATE INDEX "Assignment_startDate_endDate_idx" ON "public"."Assignment" USING "btree" ("startDate", "endDate");



CREATE INDEX "Assignment_status_idx" ON "public"."Assignment" USING "btree" ("status");



CREATE INDEX "AuditLog_changedBy_idx" ON "public"."AuditLog" USING "btree" ("changedBy");



CREATE INDEX "AuditLog_createdAt_idx" ON "public"."AuditLog" USING "btree" ("createdAt");



CREATE INDEX "AuditLog_entity_entityId_idx" ON "public"."AuditLog" USING "btree" ("entity", "entityId");



CREATE UNIQUE INDEX "CapacityConfig_consultantId_key" ON "public"."CapacityConfig" USING "btree" ("consultantId");



CREATE INDEX "CapacityConfig_country_idx" ON "public"."CapacityConfig" USING "btree" ("country");



CREATE INDEX "ChangeRequest_projectId_status_idx" ON "public"."ChangeRequest" USING "btree" ("projectId", "status");



CREATE INDEX "ConsultantBlock_consultantId_startDate_endDate_idx" ON "public"."ConsultantBlock" USING "btree" ("consultantId", "startDate", "endDate");



CREATE UNIQUE INDEX "CustomHoliday_date_country_key" ON "public"."CustomHoliday" USING "btree" ("date", "country");



CREATE INDEX "Estimation_projectId_idx" ON "public"."Estimation" USING "btree" ("projectId");



CREATE INDEX "Expense_expenseDate_idx" ON "public"."Expense" USING "btree" ("expenseDate");



CREATE INDEX "Expense_projectId_idx" ON "public"."Expense" USING "btree" ("projectId");



CREATE INDEX "ExtraHourEntry_consultantId_idx" ON "public"."ExtraHourEntry" USING "btree" ("consultantId");



CREATE INDEX "ExtraHourEntry_projectId_idx" ON "public"."ExtraHourEntry" USING "btree" ("projectId");



CREATE INDEX "ExtraHourEntry_status_idx" ON "public"."ExtraHourEntry" USING "btree" ("status");



CREATE UNIQUE INDEX "ExtraHoursConfig_country_key" ON "public"."ExtraHoursConfig" USING "btree" ("country");



CREATE INDEX "Forecast_consultantId_idx" ON "public"."Forecast" USING "btree" ("consultantId");



CREATE INDEX "Forecast_projectId_idx" ON "public"."Forecast" USING "btree" ("projectId");



CREATE INDEX "FxRateHistory_baseCode_quoteCode_effectiveDate_idx" ON "public"."FxRateHistory" USING "btree" ("baseCode", "quoteCode", "effectiveDate");



CREATE INDEX "FxRateHistory_rateType_idx" ON "public"."FxRateHistory" USING "btree" ("rateType");



CREATE INDEX "Issue_projectId_status_idx" ON "public"."Issue" USING "btree" ("projectId", "status");



CREATE INDEX "Milestone_plannedDate_idx" ON "public"."Milestone" USING "btree" ("plannedDate");



CREATE INDEX "Milestone_projectId_idx" ON "public"."Milestone" USING "btree" ("projectId");



CREATE INDEX "Milestone_status_idx" ON "public"."Milestone" USING "btree" ("status");



CREATE UNIQUE INDEX "MonthlySnapshot_projectId_year_month_key" ON "public"."MonthlySnapshot" USING "btree" ("projectId", "year", "month");



CREATE INDEX "MonthlySnapshot_year_month_idx" ON "public"."MonthlySnapshot" USING "btree" ("year", "month");



CREATE INDEX "RevenueEntry_entryDate_idx" ON "public"."RevenueEntry" USING "btree" ("entryDate");



CREATE INDEX "RevenueEntry_projectId_idx" ON "public"."RevenueEntry" USING "btree" ("projectId");



CREATE INDEX "Risk_projectId_status_idx" ON "public"."Risk" USING "btree" ("projectId", "status");



CREATE INDEX "Risk_riskScore_idx" ON "public"."Risk" USING "btree" ("riskScore");



CREATE UNIQUE INDEX "Role_name_key" ON "public"."Role" USING "btree" ("name");



CREATE INDEX "TimeEntry_consultantId_idx" ON "public"."TimeEntry" USING "btree" ("consultantId");



CREATE INDEX "TimeEntry_projectId_idx" ON "public"."TimeEntry" USING "btree" ("projectId");



CREATE INDEX "TimeEntry_status_idx" ON "public"."TimeEntry" USING "btree" ("status");



CREATE INDEX "TimeEntry_workDate_idx" ON "public"."TimeEntry" USING "btree" ("workDate");



CREATE INDEX "UserRole_roleId_idx" ON "public"."UserRole" USING "btree" ("roleId");



CREATE UNIQUE INDEX "User_email_key" ON "public"."User" USING "btree" ("email");



CREATE UNIQUE INDEX "User_microsoftOid_key" ON "public"."User" USING "btree" ("microsoftOid");



ALTER TABLE ONLY "public"."Activity"
    ADD CONSTRAINT "Activity_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "public"."Consultant"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."Activity"
    ADD CONSTRAINT "Activity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."Alert"
    ADD CONSTRAINT "Alert_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "public"."Consultant"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."Alert"
    ADD CONSTRAINT "Alert_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ApprovalDelegation"
    ADD CONSTRAINT "ApprovalDelegation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."Assignment"
    ADD CONSTRAINT "Assignment_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "public"."Consultant"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."Assignment"
    ADD CONSTRAINT "Assignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."CapacityConfig"
    ADD CONSTRAINT "CapacityConfig_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "public"."Consultant"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ChangeRequest"
    ADD CONSTRAINT "ChangeRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ConsultantBlock"
    ADD CONSTRAINT "ConsultantBlock_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "public"."Consultant"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."Estimation"
    ADD CONSTRAINT "Estimation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."Expense"
    ADD CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ExtraHourEntry"
    ADD CONSTRAINT "ExtraHourEntry_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "public"."Consultant"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ExtraHourEntry"
    ADD CONSTRAINT "ExtraHourEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."Forecast"
    ADD CONSTRAINT "Forecast_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "public"."Consultant"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."Forecast"
    ADD CONSTRAINT "Forecast_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."Issue"
    ADD CONSTRAINT "Issue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."Milestone"
    ADD CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."MonthlySnapshot"
    ADD CONSTRAINT "MonthlySnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."RevenueEntry"
    ADD CONSTRAINT "RevenueEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."Risk"
    ADD CONSTRAINT "Risk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."TimeEntry"
    ADD CONSTRAINT "TimeEntry_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "public"."Consultant"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."TimeEntry"
    ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."UserRole"
    ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."Role"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."UserRole"
    ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON UPDATE CASCADE ON DELETE CASCADE;



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON TABLE "public"."Activity" TO "anon";
GRANT ALL ON TABLE "public"."Activity" TO "authenticated";
GRANT ALL ON TABLE "public"."Activity" TO "service_role";



GRANT ALL ON TABLE "public"."Alert" TO "anon";
GRANT ALL ON TABLE "public"."Alert" TO "authenticated";
GRANT ALL ON TABLE "public"."Alert" TO "service_role";



GRANT ALL ON TABLE "public"."ApprovalDelegation" TO "anon";
GRANT ALL ON TABLE "public"."ApprovalDelegation" TO "authenticated";
GRANT ALL ON TABLE "public"."ApprovalDelegation" TO "service_role";



GRANT ALL ON TABLE "public"."Assignment" TO "anon";
GRANT ALL ON TABLE "public"."Assignment" TO "authenticated";
GRANT ALL ON TABLE "public"."Assignment" TO "service_role";



GRANT ALL ON TABLE "public"."AuditLog" TO "anon";
GRANT ALL ON TABLE "public"."AuditLog" TO "authenticated";
GRANT ALL ON TABLE "public"."AuditLog" TO "service_role";



GRANT ALL ON TABLE "public"."CapacityConfig" TO "anon";
GRANT ALL ON TABLE "public"."CapacityConfig" TO "authenticated";
GRANT ALL ON TABLE "public"."CapacityConfig" TO "service_role";



GRANT ALL ON TABLE "public"."ChangeRequest" TO "anon";
GRANT ALL ON TABLE "public"."ChangeRequest" TO "authenticated";
GRANT ALL ON TABLE "public"."ChangeRequest" TO "service_role";



GRANT ALL ON TABLE "public"."Consultant" TO "anon";
GRANT ALL ON TABLE "public"."Consultant" TO "authenticated";
GRANT ALL ON TABLE "public"."Consultant" TO "service_role";



GRANT ALL ON TABLE "public"."ConsultantBlock" TO "anon";
GRANT ALL ON TABLE "public"."ConsultantBlock" TO "authenticated";
GRANT ALL ON TABLE "public"."ConsultantBlock" TO "service_role";



GRANT ALL ON TABLE "public"."CustomHoliday" TO "anon";
GRANT ALL ON TABLE "public"."CustomHoliday" TO "authenticated";
GRANT ALL ON TABLE "public"."CustomHoliday" TO "service_role";



GRANT ALL ON TABLE "public"."Estimation" TO "anon";
GRANT ALL ON TABLE "public"."Estimation" TO "authenticated";
GRANT ALL ON TABLE "public"."Estimation" TO "service_role";



GRANT ALL ON TABLE "public"."Expense" TO "anon";
GRANT ALL ON TABLE "public"."Expense" TO "authenticated";
GRANT ALL ON TABLE "public"."Expense" TO "service_role";



GRANT ALL ON TABLE "public"."ExtraHourEntry" TO "anon";
GRANT ALL ON TABLE "public"."ExtraHourEntry" TO "authenticated";
GRANT ALL ON TABLE "public"."ExtraHourEntry" TO "service_role";



GRANT ALL ON TABLE "public"."ExtraHoursConfig" TO "anon";
GRANT ALL ON TABLE "public"."ExtraHoursConfig" TO "authenticated";
GRANT ALL ON TABLE "public"."ExtraHoursConfig" TO "service_role";



GRANT ALL ON TABLE "public"."Forecast" TO "anon";
GRANT ALL ON TABLE "public"."Forecast" TO "authenticated";
GRANT ALL ON TABLE "public"."Forecast" TO "service_role";



GRANT ALL ON TABLE "public"."FxConfig" TO "anon";
GRANT ALL ON TABLE "public"."FxConfig" TO "authenticated";
GRANT ALL ON TABLE "public"."FxConfig" TO "service_role";



GRANT ALL ON TABLE "public"."FxRateHistory" TO "anon";
GRANT ALL ON TABLE "public"."FxRateHistory" TO "authenticated";
GRANT ALL ON TABLE "public"."FxRateHistory" TO "service_role";



GRANT ALL ON TABLE "public"."Issue" TO "anon";
GRANT ALL ON TABLE "public"."Issue" TO "authenticated";
GRANT ALL ON TABLE "public"."Issue" TO "service_role";



GRANT ALL ON TABLE "public"."Milestone" TO "anon";
GRANT ALL ON TABLE "public"."Milestone" TO "authenticated";
GRANT ALL ON TABLE "public"."Milestone" TO "service_role";



GRANT ALL ON TABLE "public"."MonthlySnapshot" TO "anon";
GRANT ALL ON TABLE "public"."MonthlySnapshot" TO "authenticated";
GRANT ALL ON TABLE "public"."MonthlySnapshot" TO "service_role";



GRANT ALL ON TABLE "public"."Project" TO "anon";
GRANT ALL ON TABLE "public"."Project" TO "authenticated";
GRANT ALL ON TABLE "public"."Project" TO "service_role";



GRANT ALL ON TABLE "public"."RevenueEntry" TO "anon";
GRANT ALL ON TABLE "public"."RevenueEntry" TO "authenticated";
GRANT ALL ON TABLE "public"."RevenueEntry" TO "service_role";



GRANT ALL ON TABLE "public"."Risk" TO "anon";
GRANT ALL ON TABLE "public"."Risk" TO "authenticated";
GRANT ALL ON TABLE "public"."Risk" TO "service_role";



GRANT ALL ON TABLE "public"."Role" TO "anon";
GRANT ALL ON TABLE "public"."Role" TO "authenticated";
GRANT ALL ON TABLE "public"."Role" TO "service_role";



GRANT ALL ON TABLE "public"."TimeEntry" TO "anon";
GRANT ALL ON TABLE "public"."TimeEntry" TO "authenticated";
GRANT ALL ON TABLE "public"."TimeEntry" TO "service_role";



GRANT ALL ON TABLE "public"."User" TO "anon";
GRANT ALL ON TABLE "public"."User" TO "authenticated";
GRANT ALL ON TABLE "public"."User" TO "service_role";



GRANT ALL ON TABLE "public"."UserRole" TO "anon";
GRANT ALL ON TABLE "public"."UserRole" TO "authenticated";
GRANT ALL ON TABLE "public"."UserRole" TO "service_role";



GRANT ALL ON TABLE "public"."_prisma_migrations" TO "anon";
GRANT ALL ON TABLE "public"."_prisma_migrations" TO "authenticated";
GRANT ALL ON TABLE "public"."_prisma_migrations" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







