import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApplicationLogoutUris1789486581000 implements MigrationInterface {
  name = 'AddApplicationLogoutUris1789486581000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "applications" ADD "backchannelLogoutUri" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "applications" DROP COLUMN "backchannelLogoutUri"`);
  }
}
