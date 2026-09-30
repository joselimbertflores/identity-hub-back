import { MigrationInterface, QueryRunner } from 'typeorm';

export class SimplifyPasswordActions1790770000000 implements MigrationInterface {
  name = 'SimplifyPasswordActions1790770000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "password_action_tokens" DROP COLUMN "purpose"`);
    await queryRunner.query(`DROP TYPE "public"."password_action_tokens_purpose_enum"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "mustChangePassword"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" ADD "mustChangePassword" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(
      `CREATE TYPE "public"."password_action_tokens_purpose_enum" AS ENUM('INITIAL_SETUP', 'PASSWORD_RESET')`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_action_tokens" ADD "purpose" "public"."password_action_tokens_purpose_enum" NOT NULL DEFAULT 'PASSWORD_RESET'`,
    );
    await queryRunner.query(`ALTER TABLE "password_action_tokens" ALTER COLUMN "purpose" DROP DEFAULT`);
  }
}
