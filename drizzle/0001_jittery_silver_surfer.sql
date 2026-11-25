CREATE TABLE `advisoryOutputs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`applicationId` varchar(36) NOT NULL,
	`programmeId` varchar(80),
	`kind` enum('anomaly','progress') NOT NULL,
	`advisoryStatus` enum('review_required','unvalidated','resolved') NOT NULL,
	`value` json NOT NULL,
	`modelVersion` varchar(80),
	`reviewedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `advisoryOutputs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `appeals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`applicationId` varchar(36) NOT NULL,
	`applicantUserId` int NOT NULL,
	`message` text NOT NULL,
	`appealStatus` enum('open','reviewing','resolved') NOT NULL DEFAULT 'open',
	`resolution` text,
	`resolvedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`resolvedAt` timestamp,
	CONSTRAINT `appeals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `applicantDocuments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`applicationId` varchar(36) NOT NULL,
	`documentType` varchar(80) NOT NULL,
	`fileName` varchar(255),
	`storageKey` varchar(512),
	`documentStatus` enum('missing','uploaded','needs_review','verified','rejected') NOT NULL DEFAULT 'missing',
	`extractionConfidence` double,
	`extractedFields` json,
	`reviewNote` text,
	`reviewedBy` int,
	`uploadedAt` timestamp,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `applicantDocuments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `applicantQualifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`applicationId` varchar(36) NOT NULL,
	`qualificationType` enum('DIPLOMA','CERTIFICATE','HEAC') NOT NULL,
	`classification` enum('DISTINCTION','CREDIT','PASS','FIRST_CLASS','SECOND_CLASS','PASS_CLASS') NOT NULL,
	`qualificationName` varchar(255) NOT NULL,
	`institution` varchar(255),
	`relatedToProgramme` boolean,
	`completedYear` varchar(10),
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `applicantQualifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `applications` (
	`id` varchar(36) NOT NULL,
	`reference` varchar(32) NOT NULL,
	`applicantUserId` int NOT NULL,
	`applicantName` varchar(255) NOT NULL,
	`intake` varchar(20) NOT NULL,
	`level` enum('bachelors','diploma','certificate','higher_education_certificate') NOT NULL,
	`requestedProgrammeId` varchar(80),
	`applicationStatus` enum('draft','submitted','in_review','completed') NOT NULL DEFAULT 'draft',
	`submittedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `applications_id` PRIMARY KEY(`id`),
	CONSTRAINT `applications_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `auditEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actorUserId` int,
	`action` varchar(100) NOT NULL,
	`entityType` varchar(80) NOT NULL,
	`entityId` varchar(100) NOT NULL,
	`reason` text,
	`beforeData` json,
	`afterData` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auditEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `committeeDecisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`applicationId` varchar(36) NOT NULL,
	`programmeId` varchar(80) NOT NULL,
	`committeeDecision` enum('admit','decline','defer','request_information') NOT NULL,
	`reason` text NOT NULL,
	`decidedBy` int NOT NULL,
	`decidedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `committeeDecisions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `examResults` (
	`id` int AUTO_INCREMENT NOT NULL,
	`applicationId` varchar(36) NOT NULL,
	`exam` enum('UCE','UACE') NOT NULL,
	`subject` varchar(120) NOT NULL,
	`grade` varchar(20) NOT NULL,
	`subjectLevel` enum('PRINCIPAL','SUBSIDIARY'),
	`sitting` varchar(20) NOT NULL,
	`source` enum('applicant_entered','officer_entered','document_extracted') NOT NULL DEFAULT 'applicant_entered',
	`confirmed` boolean NOT NULL DEFAULT false,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `examResults_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recipientUserId` int NOT NULL,
	`applicationId` varchar(36),
	`title` varchar(180) NOT NULL,
	`message` text NOT NULL,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ruleSets` (
	`id` varchar(100) NOT NULL,
	`programmeId` varchar(80) NOT NULL,
	`version` varchar(40) NOT NULL,
	`effectiveFrom` varchar(20) NOT NULL,
	`ruleStatus` enum('official','adopted-proxy','assumed','needs-review') NOT NULL,
	`source` text NOT NULL,
	`edition` varchar(40) NOT NULL,
	`approval` varchar(255) NOT NULL,
	`rules` json NOT NULL,
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ruleSets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `screeningRuns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`applicationId` varchar(36) NOT NULL,
	`programmeId` varchar(80) NOT NULL,
	`programmeName` varchar(255) NOT NULL,
	`screeningOutcome` enum('ELIGIBLE','NOT_ELIGIBLE','ON_HOLD') NOT NULL,
	`ruleSetVersion` varchar(100) NOT NULL,
	`screeningRuleStatus` enum('official','adopted-proxy','assumed','needs-review') NOT NULL,
	`inputSnapshot` json NOT NULL,
	`resultTrace` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `screeningRuns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `aspireRole` enum('applicant','officer','committee','registrar','administrator') DEFAULT 'applicant' NOT NULL;--> statement-breakpoint
ALTER TABLE `advisoryOutputs` ADD CONSTRAINT `advisoryOutputs_applicationId_applications_id_fk` FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `advisoryOutputs` ADD CONSTRAINT `advisoryOutputs_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appeals` ADD CONSTRAINT `appeals_applicationId_applications_id_fk` FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appeals` ADD CONSTRAINT `appeals_applicantUserId_users_id_fk` FOREIGN KEY (`applicantUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appeals` ADD CONSTRAINT `appeals_resolvedBy_users_id_fk` FOREIGN KEY (`resolvedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `applicantDocuments` ADD CONSTRAINT `applicantDocuments_applicationId_applications_id_fk` FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `applicantDocuments` ADD CONSTRAINT `applicantDocuments_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `applicantQualifications` ADD CONSTRAINT `applicantQualifications_applicationId_applications_id_fk` FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `applications` ADD CONSTRAINT `applications_applicantUserId_users_id_fk` FOREIGN KEY (`applicantUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auditEvents` ADD CONSTRAINT `auditEvents_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `committeeDecisions` ADD CONSTRAINT `committeeDecisions_applicationId_applications_id_fk` FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `committeeDecisions` ADD CONSTRAINT `committeeDecisions_decidedBy_users_id_fk` FOREIGN KEY (`decidedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `examResults` ADD CONSTRAINT `examResults_applicationId_applications_id_fk` FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_recipientUserId_users_id_fk` FOREIGN KEY (`recipientUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_applicationId_applications_id_fk` FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ruleSets` ADD CONSTRAINT `ruleSets_updatedBy_users_id_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `screeningRuns` ADD CONSTRAINT `screeningRuns_applicationId_applications_id_fk` FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;