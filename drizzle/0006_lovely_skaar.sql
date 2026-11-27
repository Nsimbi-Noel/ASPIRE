CREATE TABLE `facultyRecommendations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`applicationId` varchar(36) NOT NULL,
	`programmeId` varchar(80) NOT NULL,
	`facultyRecommendation` enum('admit','decline','defer','request_information') NOT NULL,
	`reason` text NOT NULL,
	`facultyId` varchar(80),
	`ruleSetRecordId` varchar(100),
	`screeningRunId` int NOT NULL,
	`recommendedBy` int NOT NULL,
	`recommendedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `facultyRecommendations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `facultyRecommendations` ADD CONSTRAINT `facultyRecommendations_applicationId_applications_id_fk` FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `facultyRecommendations` ADD CONSTRAINT `facultyRecommendations_screeningRunId_screeningRuns_id_fk` FOREIGN KEY (`screeningRunId`) REFERENCES `screeningRuns`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `facultyRecommendations` ADD CONSTRAINT `facultyRecommendations_recommendedBy_users_id_fk` FOREIGN KEY (`recommendedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `facultyRecommendations_application_programme` ON `facultyRecommendations` (`applicationId`,`programmeId`);