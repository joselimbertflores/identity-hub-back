import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialIdentityHubSchema1780791381120 implements MigrationInterface {
  name = 'InitialIdentityHubSchema1780791381120';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TABLE "applications" ("id" SERIAL NOT NULL, "clientId" character varying(100) NOT NULL, "name" character varying(150) NOT NULL, "description" text, "launchUrl" character varying NOT NULL, "color" character varying(7), "clientSecretHash" character varying NOT NULL, "isConfidential" boolean NOT NULL DEFAULT true, "redirectUris" text array NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_ef68aaf1981791384fda1c2bd71" UNIQUE ("clientId"), CONSTRAINT "PK_938c0a27255637bde919591888f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE TYPE "public"."user_roles_enum" AS ENUM('USER', 'ADMIN')`);
    await queryRunner.query(
      `CREATE TABLE "user" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "login" character varying NOT NULL, "password" character varying NOT NULL, "fullName" character varying NOT NULL, "externalKey" character varying NOT NULL, "relationKey" character varying, "email" character varying, "isActive" boolean NOT NULL DEFAULT true, "mustChangePassword" boolean NOT NULL DEFAULT true, "roles" "public"."user_roles_enum" array NOT NULL DEFAULT '{USER}', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_a62473490b3e4578fd683235c5e" UNIQUE ("login"), CONSTRAINT "UQ_36cc92f41e8834a582e37a7782c" UNIQUE ("externalKey"), CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"), CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_applications" ("user_id" uuid NOT NULL, "application_id" integer NOT NULL, CONSTRAINT "PK_c5958e242454e1ba2516e8b019b" PRIMARY KEY ("user_id", "application_id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_96fbc979036902c3e8326643fb" ON "user_applications" ("user_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_b9666c3a8915cf2b2b43d721ac" ON "user_applications" ("application_id") `);
    await queryRunner.query(
      `ALTER TABLE "user_applications" ADD CONSTRAINT "FK_96fbc979036902c3e8326643fb9" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_applications" ADD CONSTRAINT "FK_b9666c3a8915cf2b2b43d721ac7" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_applications" DROP CONSTRAINT "FK_b9666c3a8915cf2b2b43d721ac7"`);
    await queryRunner.query(`ALTER TABLE "user_applications" DROP CONSTRAINT "FK_96fbc979036902c3e8326643fb9"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b9666c3a8915cf2b2b43d721ac"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_96fbc979036902c3e8326643fb"`);
    await queryRunner.query(`DROP TABLE "user_applications"`);
    await queryRunner.query(`DROP TABLE "user"`);
    await queryRunner.query(`DROP TYPE "public"."user_roles_enum"`);
    await queryRunner.query(`DROP TABLE "applications"`);
  }
}
