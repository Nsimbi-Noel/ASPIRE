CREATE TABLE `applicationProgrammes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`applicationId` varchar(36) NOT NULL,
	`programmeId` varchar(80) NOT NULL,
	`facultyId` varchar(80) NOT NULL,
	`choiceRank` int NOT NULL,
	`choiceStatus` enum('submitted','withdrawn') NOT NULL DEFAULT 'submitted',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `applicationProgrammes_id` PRIMARY KEY(`id`),
	CONSTRAINT `applicationProgrammes_application_programme` UNIQUE(`applicationId`,`programmeId`)
);
--> statement-breakpoint
CREATE TABLE `faculties` (
	`id` varchar(80) NOT NULL,
	`name` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `faculties_id` PRIMARY KEY(`id`),
	CONSTRAINT `faculties_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
INSERT IGNORE INTO `faculties` (`id`, `name`) VALUES
	('agriculture-environment', 'Faculty of Agriculture and Environment'),
	('business-administration-management', 'Faculty of Business Administration and Management'),
	('built-environment', 'Faculty of the Built Environment'),
	('education', 'Faculty of Education'),
	('law', 'Faculty of Law'),
	('science', 'Faculty of Science'),
	('arts-social-sciences', 'School of Arts and Social Sciences'),
	('health-sciences', 'Faculty of Health Sciences'),
	('engineering-applied-sciences', 'Faculty of Engineering and Applied Sciences'),
	('mother-kevin-postgraduate-medical-school', 'Mother Kevin Postgraduate Medical School'),
	('graduate-studies-research-enterprise', 'Directorate of Graduate Studies, Research and Enterprise');
--> statement-breakpoint
ALTER TABLE `examResults` MODIFY COLUMN `source` enum('applicant_entered','officer_entered','staff_entered','document_extracted') NOT NULL DEFAULT 'applicant_entered';
--> statement-breakpoint
UPDATE `examResults` SET `source` = 'staff_entered' WHERE `source` = 'officer_entered';
--> statement-breakpoint
ALTER TABLE `examResults` MODIFY COLUMN `source` enum('applicant_entered','staff_entered','document_extracted') NOT NULL DEFAULT 'applicant_entered';
--> statement-breakpoint
-- Roles are reduced to applicant, registrar and faculty_administrator.
-- officer and committee become faculty_administrator (with no faculty yet, so they see nothing until the registrar assigns one);
-- administrator becomes registrar.
ALTER TABLE `users` MODIFY COLUMN `aspireRole` enum('applicant','officer','committee','registrar','administrator','faculty_administrator') NOT NULL DEFAULT 'applicant';
--> statement-breakpoint
UPDATE `users` SET `aspireRole` = 'faculty_administrator' WHERE `aspireRole` IN ('officer', 'committee');
--> statement-breakpoint
UPDATE `users` SET `aspireRole` = 'registrar' WHERE `aspireRole` = 'administrator';
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `aspireRole` enum('applicant','registrar','faculty_administrator') NOT NULL DEFAULT 'applicant';
--> statement-breakpoint
ALTER TABLE `committeeDecisions` ADD `facultyId` varchar(80);--> statement-breakpoint
ALTER TABLE `committeeDecisions` ADD `ruleSetRecordId` varchar(100);--> statement-breakpoint
ALTER TABLE `ruleSets` ADD `effectiveTo` varchar(20);--> statement-breakpoint
ALTER TABLE `ruleSets` ADD `ruleApprovalStatus` enum('pending','approved','rejected') DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `ruleSets` ADD `approvedBy` varchar(255);--> statement-breakpoint
ALTER TABLE `ruleSets` ADD `approvalReference` varchar(255);--> statement-breakpoint
ALTER TABLE `ruleSets` ADD `approvalNote` text;--> statement-breakpoint
ALTER TABLE `ruleSets` ADD `approvedAt` timestamp;--> statement-breakpoint
ALTER TABLE `ruleSets` ADD `approvalRecordedBy` int;--> statement-breakpoint
ALTER TABLE `ruleSets` ADD `activatedAt` timestamp;--> statement-breakpoint
ALTER TABLE `ruleSets` ADD `activatedBy` int;--> statement-breakpoint
ALTER TABLE `screeningRuns` ADD `ruleSetRecordId` varchar(100);--> statement-breakpoint
ALTER TABLE `screeningRuns` ADD `facultyId` varchar(80);--> statement-breakpoint
ALTER TABLE `users` ADD `facultyId` varchar(80);--> statement-breakpoint
ALTER TABLE `ruleSets` ADD CONSTRAINT `ruleSets_programme_version` UNIQUE(`programmeId`,`version`);--> statement-breakpoint
ALTER TABLE `applicationProgrammes` ADD CONSTRAINT `applicationProgrammes_applicationId_applications_id_fk` FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `applicationProgrammes` ADD CONSTRAINT `applicationProgrammes_facultyId_faculties_id_fk` FOREIGN KEY (`facultyId`) REFERENCES `faculties`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `applicationProgrammes_faculty_status` ON `applicationProgrammes` (`facultyId`,`choiceStatus`);--> statement-breakpoint
ALTER TABLE `ruleSets` ADD CONSTRAINT `ruleSets_approvalRecordedBy_users_id_fk` FOREIGN KEY (`approvalRecordedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ruleSets` ADD CONSTRAINT `ruleSets_activatedBy_users_id_fk` FOREIGN KEY (`activatedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_facultyId_faculties_id_fk` FOREIGN KEY (`facultyId`) REFERENCES `faculties`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ruleSets_programme_effective` ON `ruleSets` (`programmeId`,`effectiveFrom`);--> statement-breakpoint
CREATE INDEX `screeningRuns_application_faculty` ON `screeningRuns` (`applicationId`,`facultyId`);