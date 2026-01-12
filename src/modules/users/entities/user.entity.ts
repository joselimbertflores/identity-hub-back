import { UserApplication } from 'src/modules/access/entities';
import { Column, Entity, OneToMany, UpdateDateColumn, CreateDateColumn, PrimaryGeneratedColumn } from 'typeorm';

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  login: string;

  @Column({ select: false })
  password: string;

  @Column()
  fullName: string;

  @Column({ unique: true, nullable: true })
  externalKey: string;

  @Column({ nullable: true })
  relationKey: string;

  @Column({ unique: true, nullable: true })
  email: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({
    type: 'enum',
    enum: UserRole,
    array: true,
    default: [UserRole.USER],
  })
  roles: UserRole[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => UserApplication, (userApplication) => userApplication.user)
  userApplications: UserApplication[];
}
